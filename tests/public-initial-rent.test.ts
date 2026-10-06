import test from 'node:test';
import assert from 'node:assert/strict';
import {newPublicInitialRent,publicInitialRent,publicCheckoutTotal} from '../src/lib/public-initial-rent';
test('public first rent keeps exact prepaid periods, inclusive SAST dates and goods separate',()=>{
 const date=new Date('2026-02-15T22:00:00Z');const initialRentSnapshot=newPublicInitialRent(2800,date);
 const r={quotedRate:2800,intendedMoveIn:date,initialRentSnapshot,packageSelection:{priceSnapshot:65}};
 assert.equal(publicCheckoutTotal(r),4165);assert.deepEqual(publicInitialRent(r).lines,[{period:'2026-02',amount:1300},{period:'2026-03',amount:2800}]);
 assert.equal(newPublicInitialRent(2800,new Date('2026-02-15T00:00:00+02:00')).total,1400);
 assert.deepEqual(newPublicInitialRent(3100,new Date('2026-12-31T00:00:00+02:00')).lines,[{period:'2026-12',amount:100},{period:'2027-01',amount:3100}]);
});
test('historical and signed reservations retain their original checkout and malformed snapshots fail closed',()=>{
 assert.equal(publicCheckoutTotal({quotedRate:2800,packageSelection:{priceSnapshot:65}}),2865);
 assert.throws(()=>publicInitialRent({quotedRate:2800,initialRentSnapshot:{version:1}}),/INVALID/);
 const date=new Date('2028-02-16T00:00:00+02:00'), snapshot=newPublicInitialRent(2900,date);
 assert.equal(snapshot.total,4300);assert.throws(()=>publicInitialRent({quotedRate:2900,intendedMoveIn:date,initialRentSnapshot:{...snapshot,total:1}}),/INVALID/);
 const reordered={total:snapshot.total,lines:snapshot.lines.map(l=>({amount:l.amount,period:l.period})),policy:{cutoffDay:15,mode:'AFTER_CUTOFF_NEXT_MONTH'},monthlyRate:2900,moveIn:snapshot.moveIn,version:1};
 assert.equal(publicInitialRent({quotedRate:2900,intendedMoveIn:date,initialRentSnapshot:reordered}).total,4300);
});
