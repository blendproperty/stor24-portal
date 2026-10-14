/** Private CreateInvoice result; never send this object or raw XML to a client.
 * Schema: https://www.netcash.co.za/netcash/xsd/invoices.xsd
 * Callers must encrypt private tokens and bind the original claimed reference.
 */
type Node = {name:string;text:string;children:Node[]};
export type PrivatePayNowInvoice = {originalReference:string;uniqueReference:string;securityToken:string;fileToken:string;supportMessage:string;methods:{type:string;text:string;entries:{name:string;value:string}[]}[]};
const invalid=()=>{throw Error("PAYNOW_INVOICE_SOURCE_REVIEW")};
function decode(value:string){
 if(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[a-f\d]+;)/i.test(value))return invalid();
 const text=value.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([a-f\d]+);/gi,(_,name:string,decimal:string,hex:string)=>{
  if(name)return({amp:"&",lt:"<",gt:">",quot:'"',apos:"'"})[name.toLowerCase()]!;
  const number=decimal?Number(decimal):parseInt(hex,16);
  if(!Number.isInteger(number)||number<1||number>0x10ffff||(number>=0xd800&&number<=0xdfff))return invalid();
  return String.fromCodePoint(number);
 });
 if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))return invalid();
 return text;
}
function tree(xml:string){
 if(Buffer.byteLength(xml,"utf8")>64000||/<!|<\?(?!xml\s)/i.test(xml))return invalid();
 xml=xml.replace(/^\uFEFF?\s*<\?xml\s[^?]*\?>/i,"").trim();
 const document:Node={name:"document",text:"",children:[]},stack=[document];let cursor=0,nodes=0;
 while(cursor<xml.length){
  const next=xml.indexOf("<",cursor);
  if(next<0){stack.at(-1)!.text+=decode(xml.slice(cursor));break;}
  stack.at(-1)!.text+=decode(xml.slice(cursor,next));
  const end=xml.indexOf(">",next);if(end<0)return invalid();
  const tag=xml.slice(next+1,end);
  if(tag.startsWith("/")){
   if(stack.length<2||tag.slice(1).trim()!==stack.at(-1)!.name)return invalid();stack.pop();
  }else{
   const match=/^([A-Za-z][A-Za-z0-9]*)(\s+(?:xmlns(?::[A-Za-z]+)?|[A-Za-z]+:[A-Za-z]+)\s*=\s*(?:"[^"]*"|'[^']*'))*\s*(\/)?$/.exec(tag);
   if(!match||++nodes>600||stack.length>8)return invalid();
   // The published schema has an empty target namespace; namespaced roots
   // cannot silently masquerade as this contract.
   if(/xmlns\s*=\s*["'][^"']+["']/.test(tag))return invalid();
   const node:Node={name:match[1],text:"",children:[]};stack.at(-1)!.children.push(node);if(!match[3])stack.push(node);
  }
  cursor=end+1;
 }
 if(stack.length!==1||document.text.trim()||document.children.length!==1)return invalid();
 return document.children[0];
}
function children(node:Node,names:string[]){if(node.text.trim()||node.children.some(c=>!names.includes(c.name)))return invalid();}
function one(node:Node,name:string){const found=node.children.filter(c=>c.name===name);if(found.length!==1)return invalid();return found[0];}
function text(node:Node,name:string,max:number){const child=one(node,name);if(child.children.length||child.text.length>max)return invalid();return child.text.trim();}
const guid=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
export function parsePayNowInvoice(xml:string,expected:{serviceKey:string;reference:string}):PrivatePayNowInvoice{
 const root=tree(xml);if(root.name!=="PayNowInvoices")return invalid();children(root,["ServiceKey","FileToken","Invoices"]);
 const key=text(root,"ServiceKey",36);if(!guid.test(key)||key.toLowerCase()!==expected.serviceKey.toLowerCase())return invalid();
 const invoices=one(root,"Invoices");children(invoices,["Invoice"]);if(invoices.children.length!==1)return invalid();
 const invoice=one(invoices,"Invoice");children(invoice,["ClientReference","UniqueReference","SecurityToken","SupportMessage","PaymentMethods"]);
 const clientReference=text(invoice,"ClientReference",100),uniqueReference=text(invoice,"UniqueReference",100),securityToken=text(invoice,"SecurityToken",36);
 if(!/^[A-Za-z0-9_-]{1,25}$/.test(expected.reference)||![clientReference,uniqueReference].includes(expected.reference)||!guid.test(securityToken)||securityToken.toLowerCase()===key.toLowerCase())return invalid();
 const methods=one(invoice,"PaymentMethods");children(methods,["PaymentMethod"]);if(!methods.children.length||methods.children.length>16)return invalid();
 return{originalReference:expected.reference,uniqueReference,securityToken,fileToken:text(root,"FileToken",200),supportMessage:text(invoice,"SupportMessage",1000),methods:methods.children.map(method=>{
  children(method,["Type","Text","Data"]);const type=text(method,"Type",40);if(!/^[A-Za-z][A-Za-z0-9 _-]*$/.test(type))return invalid();
  const data=one(method,"Data");children(data,["Entry"]);if(!data.children.length||data.children.length>32)return invalid();
  const entries=data.children.map(entry=>{children(entry,["Name","Value"]);const name=text(entry,"Name",100);if(!name)return invalid();return{name,value:text(entry,"Value",4096)}});
  if(new Set(entries.map(e=>e.name)).size!==entries.length)return invalid();
  return{type,text:text(method,"Text",300),entries};
 })};
}
export function projectPayNowInstructions(invoice:PrivatePayNowInvoice,serviceSecrets:string[]){
 const secrets=serviceSecrets.map(s=>s.toLowerCase()).filter(Boolean);
 const safe=(value:string)=>!secrets.some(secret=>value.toLowerCase().includes(secret));
 return invoice.methods.map(method=>{
  const links:{label:string;url:string}[]=[],instructions:{name:string;value:string}[]=[];let requiresReview=false;
  for(const entry of method.entries){
   if(!safe(entry.name)||!safe(entry.value)){requiresReview=true;continue;}
   if(/^https?:\/\//i.test(entry.value)){
    try{const url=new URL(entry.value);if(url.protocol!=="https:"||url.hostname!=="paynow.netcash.co.za"||url.port||url.username||url.password||url.hash||entry.value.length>2048||[...url.searchParams].some(([name,value])=>/^(m1|m2|servicekey|vendorkey|apikey)$/i.test(name)||!safe(value)))throw Error();links.push({label:entry.name,url:url.toString()});}catch{requiresReview=true;}
   }else if(/token|secret|password|authorization|security|key/i.test(entry.name)){requiresReview=true;}
   else instructions.push(entry);
  }
  if(!["EFT","CreditCard","Retail","QR"].includes(method.type))requiresReview=true;
  return{type:method.type,text:safe(method.text)?method.text:"Provider payment method",links,instructions,requiresReview};
 });
}
