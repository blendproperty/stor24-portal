import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { storagePackageUpdateSchema } from "@/lib/validators";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { organisationId, user } = await requirePermission("inventory.manage");
    const existing = await db.storagePackage.findFirst({
      where: { id, organisationId },
      include: { items: true },
    });
    if (!existing) return Response.json({ error: { code: "NOT_FOUND", message: "Package not found." } }, { status: 404 });
    await requirePermission("inventory.manage", existing.facilityId);

    const input = storagePackageUpdateSchema.parse(await request.json());
    const productCount = await db.product.count({
      where: { id: { in: input.items.map((item) => item.productId) }, organisationId, facilityId: existing.facilityId, active: true },
    });
    if (productCount !== input.items.length) {
      return Response.json({ error: { code: "INVALID_PACKAGE_PRODUCTS", message: "Every package item must be an active product at the package facility." } }, { status: 422 });
    }

    const { items, ...packageData } = input;
    const updated = await db.$transaction(async (tx) => {
      await tx.storagePackageItem.deleteMany({ where: { storagePackageId: id } });
      const storagePackage = await tx.storagePackage.update({
        where: { id },
        data: { ...packageData, badge: packageData.badge || null, minUnitAreaSqM: packageData.minUnitAreaSqM ?? null, maxUnitAreaSqM: packageData.maxUnitAreaSqM ?? null, items: { create: items } },
        include: { items: { include: { product: true } } },
      });
      await tx.auditEvent.create({
        data: { organisationId, actorId: user.id, action: "storagePackage.update", entityType: "storagePackage", entityId: id, before: existing, after: storagePackage },
      });
      return storagePackage;
    });
    return Response.json({ data: updated });
  } catch (error) {
    return authErrorResponse(error);
  }
}
