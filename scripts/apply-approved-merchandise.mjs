import {Client} from "pg";
import {randomUUID} from "node:crypto";
import {approvedMerchandise} from "../src/lib/approved-merchandise-catalogue.ts";
async function main(){
 const org=process.env.GA4_ORGANISATION_ID,facility=process.env.CATALOGUE_FACILITY_ID;
 if(!org||!facility)throw Error("An explicit organisation and facility scope is required");
 const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
 try {
  const target=(await client.query(`SELECT id FROM "Facility" WHERE id=$1 AND "organisationId"=$2 AND active=true`,[facility,org])).rows;if(target.length!==1)throw Error("Facility scope does not match");
  const actor=(await client.query(`SELECT u.id FROM "User" u JOIN "RoleAssignment" a ON a."userId"=u.id JOIN "Role" r ON r.id=a."roleId" WHERE u."organisationId"=$1 AND r.permissions @> ARRAY['*']::text[] AND a."facilityId" IS NULL LIMIT 1`,[org])).rows[0];if(!actor)throw Error("Organisation owner is required");
  const before=(await client.query(`SELECT * FROM "Product" WHERE "organisationId"=$1 AND "facilityId"=$2 ORDER BY sku`,[org,facility])).rows;
  const packages=(await client.query(`SELECT s.*,json_agg(json_build_object('productId',p.id,'sku',p.sku,'quantity',i.quantity)) AS items FROM "StoragePackage" s JOIN "StoragePackageItem" i ON i."storagePackageId"=s.id JOIN "Product" p ON p.id=i."productId" WHERE s."organisationId"=$1 AND s."facilityId"=$2 GROUP BY s.id`,[org,facility])).rows;
  const allowed=new Set(approvedMerchandise.map(p=>p.sku));
  console.log(JSON.stringify({mode:process.env.CATALOGUE_APPLY==="approved-sheet-20261008"?"apply":"preview",existing:before.length,approved:approvedMerchandise.map(p=>({sku:p.sku,retail:p.sellingPrice,cost:p.costPrice})),unavailable:before.filter(p=>!allowed.has(p.sku)).map(p=>p.sku),disabledPackages:packages.filter(p=>p.items.some((i)=>!allowed.has(i.sku))).map(p=>p.code),stock:"Unchanged; new products start at zero; historical snapshots unchanged"}));
  if(process.env.CATALOGUE_APPLY!=="approved-sheet-20261008")return;
  await client.query(`BEGIN`);
  const id=()=>`c${randomUUID().replaceAll("-","").slice(0,24)}`;
  async function audit(entityType,entityId,prior,after){await client.query(`INSERT INTO "AuditEvent" (id,"organisationId","actorId",action,"entityType","entityId",before,after,"occurredAt") VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,NOW())`,[id(),org,actor.id,`${entityType}.approved-catalogue-20261008`,entityType,entityId,JSON.stringify(prior),JSON.stringify(after)]);}
  for(const product of approvedMerchandise){
   const prior=before.find(p=>p.sku===product.sku);let after;
   if(prior){after=(await client.query(`UPDATE "Product" SET name=$1,category=$2,"costPrice"=COALESCE($3,"costPrice"),"sellingPrice"=$4,active=true,"updatedAt"=NOW() WHERE id=$5 RETURNING *`,[product.name,product.category,product.costPrice,product.sellingPrice,prior.id])).rows[0];}
   else{after=(await client.query(`INSERT INTO "Product" (id,"organisationId","facilityId",sku,name,category,"costPrice","sellingPrice","quantityOnHand","quantityReserved","reorderPoint",active,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,0,true,NOW(),NOW()) RETURNING *`,[id(),org,facility,product.sku,product.name,product.category,product.costPrice??0,product.sellingPrice])).rows[0];}
   await audit("product",after.id,prior??null,after);
  }
  for(const prior of before.filter(p=>!allowed.has(p.sku)&&p.active)){const after=(await client.query(`UPDATE "Product" SET active=false,"updatedAt"=NOW() WHERE id=$1 RETURNING *`,[prior.id])).rows[0];await audit("product",prior.id,prior,after);}
  for(const prior of packages.filter(p=>p.active&&p.items.some((i)=>!allowed.has(i.sku)))){const after=(await client.query(`UPDATE "StoragePackage" SET active=false,"updatedAt"=NOW() WHERE id=$1 RETURNING *`,[prior.id])).rows[0];await audit("storagePackage",prior.id,prior,{...after,items:prior.items});}
  const current=(await client.query(`SELECT sku,"sellingPrice",active,"quantityOnHand","quantityReserved" FROM "Product" WHERE "organisationId"=$1 AND "facilityId"=$2`,[org,facility])).rows;
  if(current.filter(p=>p.active).length!==8)throw Error("Catalogue verification failed");
  for(const prior of before){const after=current.find(p=>p.sku===prior.sku);if(after.quantityOnHand!==prior.quantityOnHand||after.quantityReserved!==prior.quantityReserved)throw Error("Stock invariant failed");}
  await client.query(`COMMIT`);console.log(JSON.stringify({verified:true,activeProducts:8,unavailableProducts:current.filter(p=>!p.active).length,newOpeningStock:0,packages: "Unavailable packages disabled; compositions and quoted prices retained pending review"}));
 }catch(error){await client.query(`ROLLBACK`);throw error;}finally{await client.end();}
}
main().catch(()=>{console.error("Catalogue update failed; transaction rolled back; inspect securely");process.exitCode=1;});
