import { db } from "./db";
import { createHash } from "node:crypto";
import { facilityWhere, requireFacility, type RequestScope } from "./scope";
import { leadAttributionSchema } from "./lead-attribution";
import {
  marketingInput,
  marketingUpdate,
  trackedUrl,
} from "./marketing-contract";
import type { z } from "zod";

export async function marketingWorkspace(scope: RequestScope) {
  const facilities = await db.facility.findMany({
    where: facilityWhere(scope),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const facilityIds = facilities.map((f) => f.id);
  const [campaigns, leads, count] = await Promise.all([
    db.marketingCampaign.findMany({
      where: {
        organisationId: scope.organisationId,
        facilityId: { in: facilityIds },
      },
      include: { links: true, activities: { orderBy: { occurredAt: "desc" } } },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    db.lead.findMany({
      where: { facilityId: { in: facilityIds } },
      select: {
        id: true,
        facilityId: true,
        stage: true,
        source: true,
        createdAt: true,
        reservations: {
          select: {
            status: true,
            journey: true,
            convertedTenancyId: true,
            convertedTenancy: { select: { status: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20000,
    }),
    db.lead.count({ where: { facilityId: { in: facilityIds } } }),
  ]);
  const evidence = leads.length
    ? await db.auditEvent.findMany({
        where: {
          organisationId: scope.organisationId,
          entityType: "Lead",
          entityId: { in: leads.map((l) => l.id) },
          action: { in: ["public_lead.created", "lead.attribution.captured"] },
        },
        select: { entityId: true, after: true },
        orderBy: { occurredAt: "asc" },
      })
    : [];
  const attribution = new Map(
    evidence.flatMap((e) => {
      const parsed = leadAttributionSchema.safeParse(
        (e.after as { attribution?: unknown } | null)?.attribution,
      );
      return parsed.success ? [[e.entityId, parsed.data] as const] : [];
    }),
  );
  const known = new Map(campaigns.map((c) => [c.id, c]));
  return {
    facilities,
    count,
    limited: count > leads.length,
    campaigns: campaigns.map((c) => ({
      ...c,
      budget: Number(c.budget),
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      links: c.links.map((l) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
        url: trackedUrl(c, l),
      })),
      activities: c.activities.map((a) => ({
        ...a,
        spend: Number(a.spend),
        occurredAt: a.occurredAt.toISOString(),
        createdAt: a.createdAt.toISOString(),
      })),
    })),
    leads: leads.map((l) => {
      const a = attribution.get(l.id) ?? null;
      const c = a?.campaignId ? known.get(a.campaignId) : null;
      const valid = c?.facilityId === l.facilityId;
      return {
        id: l.id,
        facilityId: l.facilityId,
        source: l.source,
        createdAt: l.createdAt.toISOString(),
        attribution: a
          ? {
              source: a.source,
              medium: a.medium,
              landingPage: a.landingPage,
              conversionPage: a.conversionPage,
              campaignId: valid ? c.id : null,
              linkId:
                valid && c.links.some((link) => link.id === a.linkId)
                  ? a.linkId
                  : null,
            }
          : null,
        won: l.reservations.some(
          (r) =>
            r.status === "CONVERTED" &&
            r.convertedTenancyId &&
            ["ACTIVE", "NOTICE_GIVEN"].includes(
              r.convertedTenancy?.status ?? "",
            ),
        ),
        reserved: l.reservations.some(
          (r) => r.status === "ACTIVE" && r.journey === "RENTAL",
        ),
        stage: l.stage,
      };
    }),
  };
}
export async function saveMarketing(
  scope: RequestScope,
  input: z.infer<typeof marketingInput>,
) {
  return db.$transaction(async (tx) => {
    const inputHash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const key = `marketing:${scope.organisationId}:${scope.userId}:${input.submissionId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const saved = await tx.auditEvent.findFirst({
      where: {
        organisationId: scope.organisationId,
        actorId: scope.userId,
        action: "marketing.capture.saved",
        entityId: input.submissionId,
      },
    });
    if (saved) {
      const evidence = saved.after as { recordId: string; inputHash: string };
      if (evidence.inputHash !== inputHash) throw Error("CONFLICT");
      if (!saved.facilityId) throw Error("CONFLICT");
      await requireFacility(scope, saved.facilityId);
      return { id: evidence.recordId };
    }
    async function remember(recordId: string, facilityId: string) {
      await tx.auditEvent.create({
        data: {
          organisationId: scope.organisationId,
          facilityId,
          actorId: scope.userId,
          action: "marketing.capture.saved",
          entityType: "MarketingCapture",
          entityId: input.submissionId,
          after: { recordId, inputHash },
        },
      });
      return { id: recordId };
    }
    if (input.kind === "campaign") {
      await requireFacility(scope, input.facilityId);
      const { kind: _, submissionId: retryId, ...fields } = input;
      void _;
      void retryId;
      const result = await tx.marketingCampaign.create({
        data: {
          ...fields,
          organisationId: scope.organisationId,
          startsAt: new Date(input.startsAt),
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
        },
      });
      await tx.auditEvent.create({
        data: {
          organisationId: scope.organisationId,
          facilityId: input.facilityId,
          actorId: scope.userId,
          action: "marketing.campaign.created",
          entityType: "MarketingCampaign",
          entityId: result.id,
          after: { name: result.name, status: result.status },
        },
      });
      return remember(result.id, input.facilityId);
    }
    const campaign = await tx.marketingCampaign.findFirst({
      where: {
        id: input.campaignId,
        organisationId: scope.organisationId,
        ...(!scope.unrestrictedFacilities
          ? { facilityId: { in: scope.facilityIds } }
          : {}),
      },
    });
    if (!campaign) throw new Error("NOT_FOUND");
    await requireFacility(scope, campaign.facilityId);
    const result =
      input.kind === "link"
        ? await tx.marketingLink.create({
            data: {
              campaignId: campaign.id,
              label: input.label,
              landingPage: input.landingPage,
              keyword: input.keyword || null,
            },
          })
        : await tx.marketingActivity.create({
            data: {
              campaignId: campaign.id,
              title: input.title,
              kind: input.activityKind,
              occurredAt: new Date(input.occurredAt),
              spend: input.spend,
              impressions: input.impressions,
              clicks: input.clicks,
              notes: input.notes || null,
              createdById: scope.userId,
            },
          });
    await tx.auditEvent.create({
      data: {
        organisationId: scope.organisationId,
        facilityId: campaign.facilityId,
        actorId: scope.userId,
        action: `marketing.${input.kind}.created`,
        entityType:
          input.kind === "link" ? "MarketingLink" : "MarketingActivity",
        entityId: result.id,
        after: { campaignId: campaign.id },
      },
    });
    return remember(result.id, campaign.facilityId);
  });
}
export type MarketingWorkspace = Awaited<ReturnType<typeof marketingWorkspace>>;
export async function updateMarketing(
  scope: RequestScope,
  input: z.infer<typeof marketingUpdate>,
) {
  return db.$transaction(async (tx) => {
    const activity =
      "activityId" in input
        ? await tx.marketingActivity.findFirst({
            where: {
              id: input.activityId,
              campaign: {
                organisationId: scope.organisationId,
                ...(!scope.unrestrictedFacilities
                  ? { facilityId: { in: scope.facilityIds } }
                  : {}),
              },
            },
          })
        : null;
    if ("activityId" in input && !activity) throw Error("NOT_FOUND");
    const campaign = await tx.marketingCampaign.findFirst({
      where: {
        id: "campaignId" in input ? input.campaignId : activity!.campaignId,
        organisationId: scope.organisationId,
        ...(!scope.unrestrictedFacilities
          ? { facilityId: { in: scope.facilityIds } }
          : {}),
      },
    });
    if (!campaign) throw Error("NOT_FOUND");
    await requireFacility(scope, campaign.facilityId);
    const changed =
      "activityId" in input
        ? await tx.marketingActivity.updateMany({
            where: { id: input.activityId, version: input.version },
            data: {
              title: input.title,
              kind: input.activityKind,
              occurredAt: new Date(input.occurredAt),
              spend: input.spend,
              clicks: input.clicks,
              impressions: input.impressions,
              notes: input.notes || null,
              version: { increment: 1 },
            },
          })
        : await tx.marketingCampaign.updateMany({
            where: { id: campaign.id, version: input.version },
            data: {
              name: input.name,
              budget: input.budget,
              status: input.status,
              startsAt: new Date(input.startsAt),
              endsAt: input.endsAt ? new Date(input.endsAt) : null,
              version: { increment: 1 },
            },
          });
    if (changed.count !== 1) throw Error("CONFLICT");
    await tx.auditEvent.create({
      data: {
        organisationId: scope.organisationId,
        facilityId: campaign.facilityId,
        actorId: scope.userId,
        action: activity
          ? "marketing.activity.updated"
          : "marketing.campaign.updated",
        entityType: activity ? "MarketingActivity" : "MarketingCampaign",
        entityId: activity?.id ?? campaign.id,
        before: activity
          ? {
              version: activity.version,
              title: activity.title,
              spend: Number(activity.spend),
              clicks: activity.clicks,
              impressions: activity.impressions,
              kind: activity.kind,
              occurredAt: activity.occurredAt.toISOString(),
              notes: activity.notes,
            }
          : {
              version: campaign.version,
              name: campaign.name,
              budget: Number(campaign.budget),
              status: campaign.status,
              startsAt: campaign.startsAt.toISOString(),
              endsAt: campaign.endsAt?.toISOString() ?? null,
            },
        after: input,
      },
    });
    return { id: activity?.id ?? campaign.id };
  });
}
