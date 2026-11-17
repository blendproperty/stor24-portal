import type { Prisma } from "@/generated/prisma/client";

// A reused email is not proof of a new, independent person.
export async function staffIdentityIds(tx: Prisma.TransactionClient, organisationId: string, userId: string) {
  const user = await tx.user.findFirst({ where: { id: userId, organisationId, active: true, retiredAt: null }, select: { email: true } });
  if (!user) throw new Error("FORBIDDEN");
  const aliases = await tx.deletedStaffIdentity.findMany({ where: { retained: true, organisationId, originalEmail: user.email.trim().toLowerCase() }, select: { id: true } });
  return [...new Set([userId, ...aliases.map(alias => alias.id)])];
}
