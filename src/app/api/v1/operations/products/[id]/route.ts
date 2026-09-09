import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { productUpdateSchema } from "@/lib/validators";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { organisationId, user } = await requirePermission("inventory.manage");
    const existing = await db.product.findFirst({ where: { id, organisationId } });
    if (!existing) return Response.json({ error: { code: "NOT_FOUND", message: "Product not found." } }, { status: 404 });
    await requirePermission("inventory.manage", existing.facilityId);
    const input = productUpdateSchema.parse(await request.json());
    const updated = await db.$transaction(async (tx) => {
      const product = await tx.product.update({ where: { id }, data: input });
      await tx.auditEvent.create({ data: { organisationId, actorId: user.id, action: "product.update", entityType: "product", entityId: id, before: existing, after: product } });
      return product;
    });
    return Response.json({ data: updated });
  } catch (error) {
    return authErrorResponse(error);
  }
}
