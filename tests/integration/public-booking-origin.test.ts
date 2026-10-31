import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {build} from "esbuild";
import {Prisma} from "../../src/generated/prisma/client";
import {db} from "../../src/lib/db";
import {createPublicLead} from "../../src/lib/public-lead-service";
import {publicLeadSchema} from "../../src/lib/public-lead-contract";
import {publicReservationSchema} from "../../src/lib/public-booking-contract";
import {advertisingFromSearch} from "../../src/lib/advertising-attribution";
import type * as PublicBooking from "../../src/lib/public-booking-service";

test("actual public rental and viewing producers retain explicit origin without inferring or rewriting it",async t=>{
  const url=new URL(process.env.DATABASE_URL!);assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");assert.ok(["localhost","127.0.0.1"].includes(url.hostname));assert.match(url.pathname,/^\/(?:receipt_correction_[a-z0-9_]+|merchandise_ci)$/);
  t.mock.method(globalThis,"fetch",async()=>{throw Error("External transport forbidden in origin fixture");});
  const oldVerification=process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED;process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED="false";
  const notifications:string[]=[];
  const bundled=await build({entryPoints:["src/lib/public-booking-service.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"isolated-origin-notifications",setup(builder){
    builder.onResolve({filter:/^(?:@\/lib\/(?:db|notifications)|\.\/db)$/},args=>({path:args.path,namespace:"origin-fixture"}));
    builder.onResolve({filter:/generated\/prisma\/client$/},args=>({path:args.path,namespace:"origin-prisma"}));
    builder.onLoad({filter:/.*/,namespace:"origin-prisma"},()=>({contents:"export const Prisma=__state.Prisma;"}));
    builder.onLoad({filter:/.*/,namespace:"origin-fixture"},args=>({contents:args.path.endsWith("/db")?"export const db=__state.db;":"export async function notifyReservationConfirmed(){__state.notifications.push('RENTAL');} export async function notifyViewingBooked(){__state.notifications.push('VIEWING');}"}));
  }}]});
  const loaded={exports:{} as Pick<typeof PublicBooking,"createPublicReservation">};new Function("require","module","exports","__state",bundled.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,{db,notifications,Prisma});
  const org=await db.organisation.create({data:{name:"Synthetic actual booking origin",slug:randomUUID()}});
  try{
    const slug="origin-"+randomUUID(),facility=await db.facility.create({data:{organisationId:org.id,name:"Requested store location",code:randomUUID(),publicSlug:slug,publicBookingEnabled:true}});
    await db.configurationProfile.create({data:{organisationId:org.id,facilityId:facility.id,domain:"STORE_INFORMATION",name:"Default",status:"READY",config:{officeWeekdayClosed:false,officeWeekdayStart:"00:00",officeWeekdayEnd:"23:59",officeSaturdayClosed:false,officeSaturdayStart:"00:00",officeSaturdayEnd:"23:59",officeSundayClosed:false,officeSundayStart:"00:00",officeSundayEnd:"23:59"}}});
    const type=await db.unitType.create({data:{facilityId:facility.id,name:"Synthetic origin unit",areaSqMetres:40,useTypes:["STORAGE","MICRO_WAREHOUSE"]}});
    const baseline=await Promise.all([db.payment.count(),db.ledgerEntry.count()]);
    for(const [index,journey,productLine,origin] of [[0,"RENTAL","STORAGE",{city:"Pretoria",province:"Gauteng",postalCode:"0081",country:"South Africa"}],[1,"VIEWING","STORAGE",undefined],[2,"RENTAL","MICRO_WAREHOUSE",{city:"Johannesburg",postalCode:"0012"}],[3,"VIEWING","MICRO_WAREHOUSE",{city:"Durban",postalCode:"0400"}]] as const){
      const unit=await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:"ORIGIN-"+index,floor:"Ground Floor",monthlyRate:1000,status:"AVAILABLE"}}),key=randomUUID();
      const route=productLine==="MICRO_WAREHOUSE"?"/micro-warehousing/book":"/book",advertising=advertisingFromSearch("utm_source=google&utm_medium=cpc&utm_campaign=stor24_midrand_search&utm_content=ad_826923892509_ag_201418428952&utm_term=business+storage+midrand");
      const input=publicReservationSchema.parse({attribution:{version:1,consent:"granted",landingPage:route,conversionPage:route,pages:[route],source:"google",medium:"cpc",method:"utm",advertising},facilitySlug:slug,unitId:unit.id,firstName:"Synthetic",lastName:"Origin",email:randomUUID()+"@example.invalid",phone:"+27810000000",journey,productLine,businessDetails:productLine==="MICRO_WAREHOUSE"?{companyName:"Synthetic business"}:undefined,intendedMoveIn:journey==="RENTAL"?new Date(Date.now()+86400000):undefined,viewingAt:journey==="VIEWING"?new Date(Date.now()+2*3600000):undefined,enquiryLocation:origin,idempotencyKey:key,communicationConsent:{email:false,sms:false,phone:false,whatsapp:false}});
      await loaded.exports.createPublicReservation(input,"synthetic-private-ip-hash");
      const booking=await db.reservation.findUniqueOrThrow({where:{idempotencyKey:key},include:{lead:true,customer:true}});assert.ok(booking.lead);
      const acquisition=await db.auditEvent.findFirstOrThrow({where:{entityId:booking.leadId!,action:"lead.attribution.captured"}});assert.deepEqual((acquisition.after as {attribution:unknown}).attribution,input.attribution);
      const location=booking.lead!.enquiryLocation as {city?:string;postalCode?:string;source?:string;capturedAt?:string}|null;
      if(origin){assert.equal(location?.city,origin.city);assert.equal(location?.postalCode,origin.postalCode);assert.equal(location?.source,"PUBLIC_SELF_REPORTED");assert.ok(location?.capturedAt);}
      else assert.equal(location,null);
      const audit=await db.auditEvent.findFirstOrThrow({where:{entityId:booking.id,action:"public_reservation.created"}});assert.deepEqual((audit.after as {enquiryLocation?:unknown}).enquiryLocation,origin?location:undefined);
      const before=booking.lead!.enquiryLocation;
      await loaded.exports.createPublicReservation({...input,enquiryLocation:{city:"Different replay value"}},"synthetic-replay");assert.deepEqual((await db.lead.findUniqueOrThrow({where:{id:booking.leadId!}})).enquiryLocation,before);
      assert.equal(await db.reservation.count({where:{idempotencyKey:key}}),1);
      for(const invalid of [{postalCode:81},{city:"bad\u0000place"},{city:"Pretoria",source:"STAFF_RECORDED"}])assert.equal(publicReservationSchema.safeParse({...input,enquiryLocation:invalid}).success,false);
    }
    const enquiry=await createPublicLead(publicLeadSchema.parse({facilitySlug:slug,productLine:"MICRO_WAREHOUSE",businessDetails:{companyName:"Synthetic enquiry business"},firstName:"Synthetic",lastName:"Enquiry",email:randomUUID()+"@example.invalid",phone:"+27810000000",enquiryLocation:{city:"Cape Town",postalCode:"0001"},items:"Synthetic stock",storageType:"Business"}),"synthetic-micro-enquiry");
    const enquiryLead=await db.lead.findUniqueOrThrow({where:{id:enquiry.id}});assert.equal(enquiryLead.productLine,"MICRO_WAREHOUSE");assert.equal((enquiryLead.enquiryLocation as {postalCode:string}).postalCode,"0001");assert.equal((enquiryLead.enquiryLocation as {source:string}).source,"PUBLIC_SELF_REPORTED");
    const enquiryAudit=await db.auditEvent.findFirstOrThrow({where:{entityId:enquiry.id,action:"public_lead.created"}});assert.deepEqual((enquiryAudit.after as {enquiryLocation:unknown}).enquiryLocation,enquiryLead.enquiryLocation);assert.equal(await db.reservation.count({where:{facilityId:facility.id}}),4);
    assert.deepEqual(notifications,["RENTAL","VIEWING","RENTAL","VIEWING"]);assert.deepEqual(await Promise.all([db.payment.count(),db.ledgerEntry.count()]),baseline);
  }finally{
    await db.auditEvent.deleteMany({where:{organisationId:org.id}});await db.reservation.deleteMany({where:{facility:{organisationId:org.id}}});await db.lead.deleteMany({where:{facility:{organisationId:org.id}}});await db.organisation.delete({where:{id:org.id}});await db.$disconnect();if(oldVerification===undefined)delete process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED;else process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED=oldVerification;
  }
});
