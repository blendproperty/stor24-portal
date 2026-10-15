import {SaxesParser} from 'saxes';

const SOAP='http://schemas.xmlsoap.org/soap/envelope/',TEMP='http://tempuri.org/',XSI='http://www.w3.org/2001/XMLSchema-instance';
const DATA='http://schemas.datacontract.org/2004/07/NC.DG.TMS.C.WCF.NIWS',ARRAY='http://schemas.microsoft.com/2003/10/Serialization/Arrays';
type Node={name:string;uri:string;text:string;nil:boolean;children:Node[]};
const invalid=():never=>{throw Error('MANDATE_RESPONSE_INVALID')};
function one(parent:Node,name:string,uri:string){const found=parent.children.filter(n=>n.name===name&&n.uri===uri);if(found.length!==1)return invalid();return found[0];}
/** Current NIWS_NIF SOAP1.1 response envelope; never parse isolated tag matches
 * as an accepted mandate or authenticated report. Reports retain the existing
 * four-megabyte bound; the structured AddMandate response is limited to64k. */
function result(xml:string,method:string,limit:number){
 if(Buffer.byteLength(xml,'utf8')>limit)return invalid();
 const root:Node={name:'document',uri:'',text:'',nil:false,children:[]},stack=[root];let nodes=0;
 const parser=new SaxesParser({xmlns:true,forceXMLVersion:true,defaultXMLVersion:'1.0'});
 parser.on('error',invalid);parser.on('doctype',invalid);parser.on('processinginstruction',invalid);
 parser.on('opentag',tag=>{
  if(++nodes>300||stack.length>12)return invalid();
  const attributes=Object.values(tag.attributes).filter(a=>a.uri!=='http://www.w3.org/2000/xmlns/');
  if(attributes.length>1||attributes.some(a=>a.uri!==XSI||a.local!=='nil'||!['true','false','0','1'].includes(a.value)))return invalid();
  const node:Node={name:tag.local,uri:tag.uri,text:'',nil:attributes.some(a=>['true','1'].includes(a.value)),children:[]};stack.at(-1)!.children.push(node);stack.push(node);
 });
 const append=(value:string)=>{const node=stack.at(-1)!;node.text+=value;if(node.text.length>limit)return invalid();};
 parser.on('text',append);parser.on('cdata',append);parser.on('closetag',()=>{stack.pop()});
 try{parser.write(xml).close()}catch{return invalid();}
 if(stack.length!==1||root.children.length!==1||root.text.trim())return invalid();
 const envelope=one(root,'Envelope',SOAP);
 if(envelope.nil||envelope.text.trim()||envelope.children.some(n=>n.uri!==SOAP||!['Header','Body'].includes(n.name))||envelope.children.filter(n=>n.name==='Header').length>1)return invalid();
 const body=one(envelope,'Body',SOAP);if(body.nil||body.text.trim()||body.children.length!==1)return invalid();
 const response=one(body,method+'Response',TEMP);if(response.nil||response.text.trim()||response.children.length!==1)return invalid();
 const value=one(response,method+'Result',TEMP);if(value.nil)return invalid();return value;
}
export function niwsStringResult(xml:string,method:string){
 const value=result(xml,method,4_000_000);
 if(value.children.length||!value.text.trim())return invalid();
 return value.text.trim();
}
export function mandateCreationResult(xml:string){
 const value=result(xml,'AddMandate',64000),allowed=['ErrorCode','Errors','MandateUrl','Warnings'];
 if(value.text.trim()||value.children.some(n=>n.uri!==DATA||!allowed.includes(n.name))||allowed.some(name=>value.children.filter(n=>n.name===name).length>1))return invalid();
 function scalar(name:string){const node=value.children.find(n=>n.name===name);if(!node)return null;if(node.children.length||node.text.length>300||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(node.text))return invalid();if(node.nil){if(node.text.trim())return invalid();return null}return node.text.trim();}
 for(const name of ['Errors','Warnings']){
  const node=value.children.find(n=>n.name===name);if(!node)continue;
  if(node.text.trim()||(node.nil&&node.children.length)||node.children.some(n=>n.uri!==ARRAY||n.name!=='string'||n.children.length||n.text.length>4000||(n.nil&&n.text.trim())))return invalid();
 }
 const code=scalar('ErrorCode'),url=scalar('MandateUrl');
 if(code==='000'){
  if(!url||value.children.find(n=>n.name==='Errors')?.children.length)return invalid();
  return{code,url};
 }
 // A URL paired with rejection is contradictory. Do not classify a possibly
 // created mandate as a definite failure or expose diagnostic contents.
 if(url||!['100','200','203'].includes(code??''))return invalid();
 return{code:code!,url:null};
}
