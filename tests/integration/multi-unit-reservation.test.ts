import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { createReservationBatch } from "../../src/lib/leasing-service";

test("multi-unit holds save together and conflicting requests cannot create duplicates", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Batch reservation test", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, code: key, name: "Test" } });
  const user = await db.user.create({ data: { organisationId: org.id, name: "Test", email: `${key}@example.invalid` } });
  const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Test" } });
  const unitType = await db.unitType.create({ data: { facilityId: facility.id, name: "Test", features: [] } });
  const makeUnit = (number: string) => db.unit.create({ data: { facilityId: facility.id, unitTypeId: unitType.id, number, monthlyRate: 1000, status: "AVAILABLE" } });
  const [a,b,c,d] = await Promise.all([makeUnit("A"),makeUnit("B"),makeUnit("C"),makeUnit("D")]);
  const scope = { userId:user.id, organisationId:org.id, facilityIds:[facility.id], unrestrictedFacilities:true };
  const input = (unitId:string, quotedRate=1000) => ({ unitId, facilityId:facility.id, customerId:customer.id, quotedRate });
  try {
    const pair = [c,d].sort((x,y)=>x.id.localeCompare(y.id)); await db.unit.update({where:{id:pair[1].id},data:{status:"RESERVED"}});
    await assert.rejects(createReservationBatch(scope,pair.map(u=>input(u.id))), /CONFLICT/);
    assert.equal((await db.unit.findUniqueOrThrow({where:{id:pair[0].id}})).status,"AVAILABLE");
    assert.equal(await db.reservation.count({where:{customerId:customer.id}}),0);
    const [first,second] = await Promise.allSettled([createReservationBatch(scope,[input(a.id,1100),input(b.id,1200)]),createReservationBatch(scope,[input(a.id,1100),input(b.id,1200)])]);
    assert.equal([first,second].filter(v=>v.status==="fulfilled").length,1);
    assert.equal(await db.reservation.count({where:{customerId:customer.id,status:"ACTIVE"}}),2);
    const saved = await db.reservation.findMany({where:{customerId:customer.id},orderBy:{quotedRate:"asc"}}); assert.deepEqual(saved.map(row=>Number(row.quotedRate)),[1100,1200]);
    await assert.rejects(createReservationBatch(scope,[input(pair[0].id),input(pair[0].id)]),/CONFLICT/);
    await assert.rejects(createReservationBatch({...scope,unrestrictedFacilities:false,facilityIds:[]},[input(a.id),input(b.id)]),/FORBIDDEN/);
  } finally { await db.$disconnect(); }
});
