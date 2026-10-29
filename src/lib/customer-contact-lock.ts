import type { Prisma } from "@/generated/prisma/client";

// Contact edits and identity grants must serialize on the same customer.
export async function lockCustomerContact(tx: Prisma.TransactionClient, customerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`customer-contact:${customerId}`}, 0))`;
}
