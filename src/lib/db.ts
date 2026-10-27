import { PrismaClient } from "@/generated/prisma/client";
import { SequentialPrismaPg } from "@/lib/sequential-prisma-pg";
import { databaseConfig } from "@/lib/database-limits";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Production route bundles can evaluate this module independently in one Node
// process. Reuse the client (and its bounded pool) across those bundles as well
// as development reloads; each separate process still owns its own pool.
export const db = globalForPrisma.prisma ?? new PrismaClient({
  adapter: new SequentialPrismaPg(databaseConfig(process.env.DATABASE_URL)),
});
globalForPrisma.prisma = db;
