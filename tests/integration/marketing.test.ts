import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import {
  saveMarketing,
  marketingWorkspace,
  updateMarketing,
} from "../../src/lib/marketing-service";
const enabled = process.env.MARKETING_DB_TEST === "isolated-ci";
test(
  "marketing saves persist atomically, reject cross-store records and replay once",
  { skip: !enabled },
  async () => {
    assert.ok(
      ["localhost", "127.0.0.1"].includes(
        new URL(process.env.DATABASE_URL!).hostname,
      ),
    );
    const key = randomUUID(),
      org = await db.organisation.create({
        data: { name: "Isolated marketing test", slug: key },
      });
    try {
      const facility = await db.facility.create({
          data: {
            organisationId: org.id,
            name: "Marketing fixture",
            code: key,
          },
        }),
        other = await db.facility.create({
          data: {
            organisationId: org.id,
            name: "Excluded fixture",
            code: randomUUID(),
          },
        }),
        user = await db.user.create({
          data: {
            organisationId: org.id,
            name: "Fixture staff",
            email: `${key}@example.invalid`,
            passwordHash: "not-a-login",
          },
        });
      const scope = {
        organisationId: org.id,
        userId: user.id,
        facilityIds: [facility.id],
        unrestrictedFacilities: false,
      };
      const input = {
        kind: "campaign" as const,
        submissionId: randomUUID(),
        facilityId: facility.id,
        name: "Fixture campaign",
        source: "google" as const,
        medium: "cpc" as const,
        budget: 1000,
        status: "ACTIVE" as const,
        startsAt: "2026-10-04T00:00:00Z",
        endsAt: null,
      };
      const [first, retry] = await Promise.all([
        saveMarketing(scope, input),
        saveMarketing(scope, input),
      ]);
      assert.equal(first.id, retry.id);
      assert.equal(
        await db.marketingCampaign.count({ where: { organisationId: org.id } }),
        1,
      );
      await assert.rejects(
        saveMarketing(scope, { ...input, name: "Altered retry" }),
        /CONFLICT/,
      );
      await assert.rejects(
        saveMarketing(scope, {
          ...input,
          submissionId: randomUUID(),
          facilityId: other.id,
        }),
        /FORBIDDEN/,
      );
      const link = await saveMarketing(scope, {
        kind: "link",
        submissionId: randomUUID(),
        campaignId: first.id,
        label: "Fixture link",
        landingPage: "/",
        keyword: "Internal keyword",
      });
      const activity = {
        kind: "activity" as const,
        submissionId: randomUUID(),
        campaignId: first.id,
        title: "Fixture spend",
        activityKind: "ADVERTISING" as const,
        occurredAt: "2026-10-04T10:00:00Z",
        spend: 100,
        clicks: 5,
        impressions: 50,
      };
      const saved = await saveMarketing(scope, activity);
      assert.equal((await saveMarketing(scope, activity)).id, saved.id);
      assert.equal(
        await db.marketingActivity.count({ where: { campaignId: first.id } }),
        1,
      );
      await updateMarketing(scope, {
        campaignId: first.id,
        version: 1,
        name: "Updated fixture",
        budget: 2000,
        status: "PAUSED",
        startsAt: input.startsAt,
        endsAt: null,
      });
      await assert.rejects(
        updateMarketing(scope, {
          campaignId: first.id,
          version: 1,
          name: "Stale update",
          budget: 10,
          status: "ACTIVE",
          startsAt: input.startsAt,
          endsAt: null,
        }),
        /CONFLICT/,
      );
      await updateMarketing(scope, {
        activityId: saved.id,
        version: 1,
        title: "Corrected fixture",
        activityKind: "ADVERTISING",
        occurredAt: activity.occurredAt,
        spend: 80,
        clicks: 4,
        impressions: 50,
      });
      assert.equal(
        Number(
          (
            await db.marketingActivity.findUniqueOrThrow({
              where: { id: saved.id },
            })
          ).spend,
        ),
        80,
      );
      await assert.rejects(
        saveMarketing(
          { ...scope, facilityIds: [other.id] },
          { ...activity, submissionId: randomUUID() },
        ),
        /NOT_FOUND/,
      );
      const lead = await db.lead.create({
          data: { facilityId: facility.id, source: "Website" },
        }),
        crossLead = await db.lead.create({
          data: { facilityId: other.id, source: "Website" },
        });
      const attribution = {
        version: 1,
        consent: "granted",
        landingPage: "/",
        conversionPage: "/book",
        pages: ["/"],
        source: "google",
        medium: "cpc",
        campaignId: first.id,
        linkId: link.id,
      };
      for (const l of [lead, crossLead])
        await db.auditEvent.create({
          data: {
            organisationId: org.id,
            facilityId: l.facilityId,
            entityType: "Lead",
            entityId: l.id,
            action: "lead.attribution.captured",
            after: { attribution },
          },
        });
      const workspace = await marketingWorkspace(scope);
      assert.equal(workspace.leads.length, 1);
      assert.equal(workspace.leads[0].attribution?.campaignId, first.id);
      assert.equal(workspace.leads[0].won, false);
      const otherWorkspace = await marketingWorkspace({
        ...scope,
        facilityIds: [other.id],
      });
      assert.equal(otherWorkspace.campaigns.length, 0);
      assert.equal(otherWorkspace.leads[0].attribution?.campaignId, null);
      assert.equal(
        (await marketingWorkspace({ ...scope, facilityIds: [] })).leads.length,
        0,
      );
      const constraint = `marketing_audit_${key.replaceAll("-", "")}`;
      await db.$executeRawUnsafe(
        `ALTER TABLE "AuditEvent" ADD CONSTRAINT "${constraint}" CHECK ("action" <> 'marketing.activity.created' OR "organisationId" <> '${org.id}') NOT VALID`,
      );
      try {
        await assert.rejects(
          saveMarketing(scope, {
            ...activity,
            submissionId: randomUUID(),
            title: "Must roll back",
          }),
        );
        assert.equal(
          await db.marketingActivity.count({ where: { campaignId: first.id } }),
          1,
        );
      } finally {
        await db.$executeRawUnsafe(
          `ALTER TABLE "AuditEvent" DROP CONSTRAINT "${constraint}"`,
        );
      }
    } finally {
      const campaigns = await db.marketingCampaign.findMany({
          where: { organisationId: org.id },
          select: { id: true },
        }),
        ids = campaigns.map((c) => c.id);
      await db.marketingActivity.deleteMany({
        where: { campaignId: { in: ids } },
      });
      await db.marketingLink.deleteMany({ where: { campaignId: { in: ids } } });
      await db.marketingCampaign.deleteMany({
        where: { organisationId: org.id },
      });
      await db.auditEvent.deleteMany({ where: { organisationId: org.id } });
      await db.lead.deleteMany({
        where: { facility: { organisationId: org.id } },
      });
      await db.user.deleteMany({ where: { organisationId: org.id } });
      await db.organisation.delete({ where: { id: org.id } });
      await db.$disconnect();
    }
  },
);
