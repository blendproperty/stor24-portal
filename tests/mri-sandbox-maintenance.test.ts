import assert from 'node:assert/strict';import test from 'node:test';
import {mriSandboxMaintenanceSchema,prepareMriSandboxMaintenance} from '../src/lib/mri-sandbox-maintenance';
test('operator sandbox repair refuses caller target/identity overrides and disabled apply before database/provider work',async()=>{
 const input={organisationId:'cmfixtureorganisation0000001',primaryRevision:'2026-10-15T04:00:00.000Z',maintenanceReference:'synthetic-preview-only'};
 assert.equal(mriSandboxMaintenanceSchema.safeParse(input).success,true);
 for(const extra of [{target:'Blend'},{databaseIdentifier:'live-db'},{actorId:'forged-user'},{postingEnabled:true}])assert.equal(mriSandboxMaintenanceSchema.safeParse({...input,...extra}).success,false);
 const old=process.env.MRI_SANDBOX_MAINTENANCE_ENABLED;delete process.env.MRI_SANDBOX_MAINTENANCE_ENABLED;let calls=0;
 try{await assert.rejects(prepareMriSandboxMaintenance(input,{apply:true,fetcher:async()=>{calls++;throw Error('Unexpected provider call')}}),/^Error: MRI_SANDBOX_MAINTENANCE_DISABLED$/);assert.equal(calls,0);}finally{if(old===undefined)delete process.env.MRI_SANDBOX_MAINTENANCE_ENABLED;else process.env.MRI_SANDBOX_MAINTENANCE_ENABLED=old;}
});
