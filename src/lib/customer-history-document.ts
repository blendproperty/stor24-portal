import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, rgb, type PDFPage, type PDFFont, StandardFonts } from "pdf-lib";

export type HistoryExportRow = Record<string, string | number | boolean | null>;
export async function customerHistoryPdf(customer: string, rows: HistoryExportRow[], summary: string, generatedAt: Date) {
  const pdf = await PDFDocument.create(); pdf.setTitle("STOR24 customer contact history"); pdf.setAuthor("STOR24"); pdf.registerFontkit(fontkit);
  const headingFont = await pdf.embedFont(await readFile(join(process.cwd(), "public/brand/Satoshi-Variable.ttf")), { subset: true });
  const bodyFont=await pdf.embedFont(StandardFonts.Helvetica);
  const supported=new Map([[headingFont,new Set(headingFont.getCharacterSet())],[bodyFont,new Set(bodyFont.getCharacterSet())]]);let substitutedCharacters=false;
  const symbolLabels:Record<number,string>={0x1f44b:"[wave]",0x2705:"[check]",0x274c:"[cross]",0x26a0:"[warning]",0x1f44d:"[thumbs up]",0x1f44e:"[thumbs down]",0x1f512:"[lock]",0x1f4de:"[phone]",0x1f4e7:"[email]"};
  const ink = rgb(.08,.18,.21), muted = rgb(.36,.44,.47), orange = rgb(.94,.32,.02);
  const width=499,left=48,bottom=54,leading=14; let page!: PDFPage, y=0;
  const clean=(s:string,font:PDFFont)=>Array.from(s.normalize("NFC").replace(/\r\n?/g,"\n").replace(/\t/g," ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,"")).map(c=>{const point=c.codePointAt(0)!;if(c==="\n"||supported.get(font)!.has(point))return c;substitutedCharacters=true;return symbolLabels[point]??`[U+${point.toString(16).toUpperCase()}]`;}).join("");
  const wrap=(text:string,size:number,font:PDFFont)=> {
    const lines:string[]=[];
    for(const paragraph of clean(text,font).split("\n")) { let current=""; for(const character of paragraph) { if(current&&font.widthOfTextAtSize(current+character,size)>width){const space=current.lastIndexOf(" ");if(space>0){lines.push(current.slice(0,space));current=current.slice(space+1);}else{lines.push(current);current="";}}current+=character; } lines.push(current); }
    return lines;
  };
  const newPage=()=>{page=pdf.addPage([595,842]);page.drawRectangle({x:0,y:790,width:595,height:52,color:ink});page.drawRectangle({x:0,y:787,width:595,height:3,color:orange});page.drawText("STOR24  /  CUSTOMER HISTORY",{x:left,y:810,size:15,font:headingFont,color:rgb(1,1,1)});y=763;};
  const text=(value:string,size=10,color=ink,font=bodyFont)=>{const step=size<=9?12:Math.max(leading,size*1.25);for(const line of wrap(value,size,font)){if(!line){y-=6;continue;}if(y<bottom+step)newPage();page.drawText(line,{x:left,y,size,font,color});y-=step;}};
  newPage();text(customer,19,ink,headingFont);y-=9;text(summary,9,muted);text("Generated "+generatedAt.toLocaleString("en-ZA",{timeZone:"Africa/Johannesburg"})+" SAST",9,muted);
  text("Confidential - authorised staff only. Dates/statuses reproduce recorded evidence.",9,muted);y-=15;
  if(!rows.length)text("No recorded history matches the selected filters.");
  for(const [index,row] of rows.entries()){
    if(y<bottom+110)newPage();page.drawLine({start:{x:left,y:y+4},end:{x:left+width,y:y+4},color:rgb(.83,.88,.89),thickness:.5});y-=14;
    text(`${index+1}. ${row.title}`,12,ink,headingFont);text(`${row.recordedAtSast || "Original date not recorded"} | ${row.store || "Store not recorded"} | ${row.author || "System / author not recorded"}`,9,muted);
    if(row.category)text("Category: "+row.category,9,muted);
    if(row.status)text("Recorded status: "+row.status,9);
    if(row.subject)text("Subject: "+row.subject,10);
    if(row.body)text(String(row.body));
    for(const [field,label] of [["sentAtSast","Sent"],["deliveredAtSast","Delivered"],["readAtSast","Read"]] as const)if(row[field])text(label+": "+row[field],9,muted);
    if(row.evidenceLimit)text(String(row.evidenceLimit),9,muted);
    text("Record: "+row.recordId,8,muted);y-=14;
  }
  const pages=pdf.getPages();pages.forEach((p,i)=>{if(substitutedCharacters)p.drawText("Print copy: bracketed labels replace unsupported symbols; CSV retains original text.",{x:left,y:40,size:7,font:bodyFont,color:muted});p.drawText(`STOR24 | ${i+1} / ${pages.length}`,{x:left,y:28,size:8,font:bodyFont,color:muted});});
  return new Uint8Array(await pdf.save());
}
