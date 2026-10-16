import test from 'node:test';
import assert from 'node:assert/strict';
import {refundRequestProjectionSchema} from '../src/components/netcash-refund-request-actions';
test('staff request projection rejects ambiguous claim state and raw response or credential fields',()=>{
 const value={id:'netcash-refund-attempt:'+'1'.repeat(64),refundId:'netcash-refund:'+'1'.repeat(64),facilityId:'store',revision:3,state:'CLAIMED',created:{actorId:'sender',at:'2026-10-16T08:00:00Z',reference:'Synthetic request'},review:{actorId:'reviewer',at:'2026-10-16T08:01:00Z',reference:'Synthetic separate review'},claimAt:'2026-10-16T08:02:00Z',claimRetained:true,providerOutcome:'CLAIMED_NO_VERIFIED_RESULT',providerCode:null,responseComplete:null,financialPosting:false,retryAvailable:false};
 assert.equal(refundRequestProjectionSchema.parse(value).claimRetained,true);
 for(const change of [{claimRetained:false},{claimAt:null},{providerOutcome:'NOT_CLAIMED'},{bodyBase64:'private'},{serviceKey:'private'},{financialPosting:true},{retryAvailable:true}])assert.equal(refundRequestProjectionSchema.safeParse({...value,...change}).success,false);
});
