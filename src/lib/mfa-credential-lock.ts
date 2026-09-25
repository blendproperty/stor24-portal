import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/** One shared parent lock covers consumption, enrollment and deletion/recreation. */
export function withMfaUserLock<T>(userId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    return operation(tx);
  });
}