import { createHash } from "node:crypto";
import { z } from "zod";
import type { CommunicationFilters } from "./communication-log-query";
import type { RequestScope } from "./scope";
const schema = z.object({ version: z.literal(1), at: z.iso.datetime(), id: z.cuid(), snapshot: z.iso.datetime(), filters: z.string().regex(/^[a-f0-9]{64}$/), scope: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function binding(filters: CommunicationFilters, scope: RequestScope) {
  return { filters: hash(filters), scope: hash({ userId: scope.userId, organisationId: scope.organisationId, unrestricted: scope.unrestrictedFacilities, facilities: [...new Set(scope.facilityIds)].sort() }) };
}
export function readCommunicationCursor(value: string, filters: CommunicationFilters, scope: RequestScope) {
  if (!value) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 1800) throw Error();
    const cursor = schema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    const expected = binding(filters, scope);
    if (cursor.filters !== expected.filters || cursor.scope !== expected.scope || cursor.at > cursor.snapshot || new Date(cursor.snapshot).getTime() > Date.now() + 30_000) throw Error();
    return cursor;
  } catch { throw Error("COMMUNICATION_CURSOR_INVALID"); }
}
export function communicationCursor(row: { id: string; queuedAt: Date }, snapshot: Date, filters: CommunicationFilters, scope: RequestScope) {
  return Buffer.from(JSON.stringify({ version: 1, id: row.id, at: row.queuedAt.toISOString(), snapshot: snapshot.toISOString(), ...binding(filters, scope) })).toString("base64url");
}
