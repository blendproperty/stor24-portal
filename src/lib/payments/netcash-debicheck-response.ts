import {SaxesParser} from 'saxes';
const SOAP='http://schemas.xmlsoap.org/soap/envelope/',TEMP='http://tempuri.org/';
export const DEBICHECK_DATA_NAMESPACE='http://schemas.datacontract.org/2004/07/NC.DG.TMS.C.WCF.NIWS';
const XSI='http://www.w3.org/2001/XMLSchema-instance';
type Node={name:string;uri:string;text:string;nil:boolean;children:Node[]};
const invalid=()=>{throw Error('DEBICHECK_RESPONSE_REVIEW')};
function one(node:Node,name:string,uri:string){const found=node.children.filter(c=>c.name===name&&c.uri===uri);if(found.length!==1)return invalid();return found[0];}
export function debiCheckSoapResult(xml:string,method:string){
 if(Buffer.byteLength(xml,'utf8')>64000)return invalid();
 const document:Node={name:'document',uri:'',text:'',nil:false,children:[]},stack=[document];let count=0;
 const parser=new SaxesParser({xmlns:true,forceXMLVersion:true,defaultXMLVersion:'1.0'});
 parser.on('error',invalid);parser.on('doctype',invalid);parser.on('processinginstruction',invalid);
 parser.on('opentag',tag=>{
  if(++count>300||stack.length>12)return invalid();
  const attributes=Object.values(tag.attributes).filter(a=>a.uri!=='http://www.w3.org/2000/xmlns/');
  if(attributes.length>1||attributes.some(a=>a.uri!==XSI||a.local!=='nil'||!['true','false','1','0'].includes(a.value)))return invalid();
  const node:Node={name:tag.local,uri:tag.uri,text:'',nil:attributes.some(a=>['true','1'].includes(a.value)),children:[]};stack.at(-1)!.children.push(node);stack.push(node);
 });
 const text=(value:string)=>{const node=stack.at(-1)!;node.text+=value;if(node.text.length>64000)return invalid();};
 parser.on('text',text);parser.on('cdata',text);parser.on('closetag',()=>{stack.pop()});
 try{parser.write(xml).close()}catch{return invalid();}
 if(stack.length!==1||document.children.length!==1)return invalid();
 const envelope=one(document,'Envelope',SOAP);if(envelope.text.trim()||envelope.children.some(c=>c.uri!==SOAP||!['Header','Body'].includes(c.name)))return invalid();
 const body=one(envelope,'Body',SOAP);if(body.text.trim()||body.children.length!==1)return invalid();
 const response=one(body,method+'Response',TEMP);if(response.text.trim()||response.children.length!==1)return invalid();
 const result=one(response,method+'Result',TEMP);if(result.nil||result.text.trim()||result.children.some(c=>c.uri!==DEBICHECK_DATA_NAMESPACE))return invalid();
 return result;
}
export function debiCheckScalar(node:Node,name:string,nullable=false){
 const field=one(node,name,DEBICHECK_DATA_NAMESPACE);if(field.children.length||field.text.length>300||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(field.text))return invalid();
 if(field.nil){if(!nullable||field.text.trim())return invalid();return null;}
 return field.text.trim();
}
export function debiCheckDayOptions(node:Node){
 const field=one(node,'InitiationDayOptions',DEBICHECK_DATA_NAMESPACE);
 if(field.nil||field.text.trim()||!field.children.length||field.children.length>62)return invalid();
 const values=field.children.map(c=>{if(c.uri!=='http://schemas.microsoft.com/2003/10/Serialization/Arrays'||c.name!=='string'||c.nil||c.children.length||!/^MNTH_(?:0[1-9]|[12]\d|3[01])$/.test(c.text))return invalid();return c.text;});
 if(new Set(values).size!==values.length)return invalid();return values;
}
