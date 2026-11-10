import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { userRemovalDependencies } from "../../src/lib/staff-user-removal";

const start=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve};};
test("staff deletion fence serializes business writers and rejects stale references",async t=>{
  assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");assert.equal(new URL(process.env.DATABASE_URL!).hostname,"localhost");
  const key=randomUUID(),org=await db.organisation.create({data:{name:"Fence synthetic",slug:key}});
  async function user(){return db.user.create({data:{organisationId:org.id,name:"Synthetic",email:`${randomUUID()}@example.invalid`,active:false}})}
  try{
    await t.test("writer that commits first is observed before deletion",async()=>{
      const u=await user(),written=start(),release=start();
      const writer=db.$transaction(async tx=>{await tx.configurationProfile.create({data:{organisationId:org.id,domain:"CI",name:randomUUID(),config:{reviewerId:u.id}}});written.resolve();await release.promise;},{timeout:20000});
      await written.promise;
      const deletion=db.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(143,2441)::text`;return userRemovalDependencies(tx,u.id);},{isolationLevel:"ReadCommitted",timeout:20000});
      release.resolve();await writer;assert.ok((await deletion).includes("ConfigurationProfile data"));assert.ok(await db.user.findUnique({where:{id:u.id}}));
    });
    for(const isolation of ["ReadCommitted","RepeatableRead","Serializable"] as const) await t.test(`deletion first blocks a stale ${isolation} writer`,async()=>{
      const u=await user(),snapshot=start(),attempt=start(),held=start(),commit=start();
      const writer=db.$transaction(async tx=>{await tx.user.findUnique({where:{id:u.id}});snapshot.resolve();await attempt.promise;await tx.configurationProfile.create({data:{organisationId:org.id,domain:"CI",name:randomUUID(),config:{nested:{reviewerId:u.id}}}});},{isolationLevel:isolation,timeout:20000});
      const observed=writer.then(()=>false,()=>true);
      await snapshot.promise;
      const deletion=db.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(143,2441)::text`;assert.deepEqual(await userRemovalDependencies(tx,u.id),[]);await tx.staffDeletionFence.update({where:{id:1},data:{generation:{increment:1}}});await tx.deletedStaffIdentity.create({data:{id:u.id}});await tx.user.delete({where:{id:u.id}});held.resolve();await commit.promise;},{isolationLevel:"ReadCommitted",timeout:20000});
      await held.promise;attempt.resolve();
      let waiting=false;
      try {
        for(let i=0;i<100;i++){
          const rows=await db.$queryRaw<{waiting:boolean}[]>`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=143 AND objid=2441 AND NOT granted) AS waiting`;
          if(rows[0].waiting){waiting=true;break;} await new Promise(r=>setTimeout(r,20));
        }
      } finally { commit.resolve(); }
      await deletion;assert.equal(waiting,true,"writer must wait on the deletion fence");assert.equal(await observed,true);assert.equal(await db.user.findUnique({where:{id:u.id}}),null);
      assert.equal(await db.configurationProfile.count({where:{organisationId:org.id,config:{path:["nested","reviewerId"],equals:u.id}}}),0);
      await assert.rejects(db.configurationProfile.create({data:{organisationId:org.id,domain:"CI",name:randomUUID(),config:{embedded:`c${u.id}`}}}));
      await assert.rejects(db.configurationProfile.create({data:{organisationId:org.id,domain:"CI",name:randomUUID(),config:{nested:{reviewerId:u.id}}}}));
      await db.configurationProfile.create({data:{organisationId:org.id,domain:"CI",name:randomUUID(),config:{safe:"unrelated"}}});
    });
  }finally{await db.$disconnect();}
});
