import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {isPublicPathname} from '../src/proxy';
import {POST} from '../src/app/api/v1/marketing/conversions/worker/route';

test('only the exact conversion worker reaches its own credential guard without a staff session',()=>{
 assert.equal(isPublicPathname('/api/v1/marketing/conversions/worker'),true);
 for(const path of ['/api/v1/marketing/conversions','/api/v1/marketing/conversions/worker/extra','/api/v1/marketing/conversions/worker-other','/settings/advertising'])assert.equal(isPublicPathname(path),false);
});
test('worker requires its independent key even with a staff cookie, and fails closed without configuration',async()=>{
 const env={...process.env},key=randomBytes(32).toString('hex');
 try{
  process.env.REPORT_CRON_SECRET_SHA256=createHash('sha256').update(key).digest('hex');
  delete process.env.ADVERTISING_ORGANISATION_ID; // No fixture database/provider work.
  for(const headers of [new Headers(),new Headers({cookie:'staff-session=fixture'}),new Headers({'x-cron-key':'invalid'})]){
   const r=await POST(new Request('https://portal.stor24.co.za/api/v1/marketing/conversions/worker',{method:'POST',headers}));assert.equal(r.status,401);assert.ok(!(await r.text()).includes(key));
  }
  const r=await POST(new Request('https://portal.stor24.co.za/api/v1/marketing/conversions/worker',{method:'POST',headers:{'x-cron-key':key}}));assert.equal(r.status,200);assert.deepEqual(await r.json(),{data:{accepted:0,failed:0}});
  delete process.env.REPORT_CRON_SECRET_SHA256;
  assert.equal((await POST(new Request('https://portal.stor24.co.za/api/v1/marketing/conversions/worker',{method:'POST',headers:{'x-cron-key':key}}))).status,503);
 }finally{process.env=env;}
});
