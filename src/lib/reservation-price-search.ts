import {db} from "./db";
import {facilityWhere,type RequestScope} from "./scope";
import type {Prisma} from "@/generated/prisma/client";

export function priceSearchWhere(scope:RequestScope,query:string):Prisma.ReservationWhereInput {
  const contains=(value:string)=>({contains:value,mode:"insensitive" as const});
  const tokens=query.split(/\s+/).filter(Boolean).slice(0,8);
  return {facility:facilityWhere(scope),customer:{organisationId:scope.organisationId},OR:[
    {id:contains(query)},{publicReference:contains(query)},
    {unit:{number:{equals:query,mode:"insensitive"}}},
    {customer:{email:contains(query)}},{customer:{phone:contains(query)}},
    {customer:{companyName:contains(query)}},
    {AND:tokens.map(token=>({OR:[{customer:{firstName:contains(token)}},{customer:{lastName:contains(token)}}]}))}
  ]};
}
export async function searchReservationPrices(scope:RequestScope,query:string,page:number){
  const rows=await db.reservation.findMany({where:priceSearchWhere(scope,query),
    orderBy:[{createdAt:"desc"},{id:"desc"}],skip:page*20,take:21,
    select:{id:true,publicReference:true,status:true,quotedRate:true,
      facility:{select:{name:true}},unit:{select:{number:true}},
      customer:{select:{firstName:true,lastName:true,companyName:true,email:true}}}});
  return {items:rows.slice(0,20).map(row=>({id:row.id,reference:row.publicReference,
    customer:row.customer.companyName||[row.customer.firstName,row.customer.lastName].filter(Boolean).join(" ")||"Customer",
    email:row.customer.email,facility:row.facility.name,unit:row.unit?.number??null,
    status:row.status,monthlyRate:row.quotedRate.toFixed(2)})),hasMore:rows.length>20,page};
}
