import { rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import type { ReportRow } from "./report-data-service";

/** Fixed-width column bands retain all selected fields, including long cells. */
export async function visualReportTablePdf(pdf:PDFDocument,font:PDFFont,title:string,rows:ReportRow[],period:string) {
  const ink=rgb(0.08,0.19,0.23),orange=rgb(0.91,0.33,0.07),white=rgb(1,1,1),muted=rgb(0.39,0.46,0.5);
  const left=35,width=772,bottom=48,size=8,leading=10;
  const clean=(value:string)=>value.replace(/[\x00-\x1f\x7f\u00a0\u202f]/g," ");
  const wrap=(value:string,available:number,fontSize=size)=>{
    const lines:string[]=[];let line="";
    for(const character of clean(value)){
      while(line&&font.widthOfTextAtSize(line+character,fontSize)>available){
        const space=line.lastIndexOf(" ");
        if(space>0){lines.push(line.slice(0,space));line=line.slice(space+1);}
        else{lines.push(line);line="";}
      }
      line+=character;
    }
    lines.push(line);return lines;
  };
  const keys=Object.keys(rows[0]??{}),bands:string[][]=[];
  for(let index=0;index<keys.length;index+=7)bands.push(keys.slice(index,index+7));
  if(!bands.length)bands.push([]);
  let page!:PDFPage;let y=0;
  const generated=new Date().toLocaleString("en-ZA",{timeZone:"Africa/Johannesburg"});
  for(const [bandIndex,band] of bands.entries()){
    const columnWidth=band.length?(width-30)/band.length:width-30;
    const headerLines=[['#'],...band.map(key=>wrap(key,columnWidth-10))],headerHeight=Math.max(...headerLines.map(lines=>lines.length))*leading+12;
    const drawCells=(cells:string[][],top:number,height:number,shade:boolean,header=false)=>{
      page.drawRectangle({x:left,y:top-height,width,height,color:header?ink:shade?rgb(0.95,0.97,0.98):white});
      let x=left;
      cells.forEach((lines,index)=>{lines.forEach((line,lineIndex)=>page.drawText(line,{x:x+5,y:top-12-lineIndex*leading,size,font,color:header?white:ink}));x+=index===0?30:columnWidth;});
      page.drawLine({start:{x:left,y:top-height},end:{x:left+width,y:top-height},thickness:0.4,color:rgb(0.84,0.88,0.9)});
    };
    const newPage=()=>{
      page=pdf.addPage([842,595]);page.drawRectangle({x:0,y:550,width:842,height:45,color:ink});
      page.drawRectangle({x:0,y:547,width:842,height:3,color:orange});
      page.drawText("STOR24",{x:left,y:566,size:19,font,color:white});y=525;
      for(const line of wrap(title,width,15)){page.drawText(line,{x:left,y,size:15,font,color:ink});y-=18;}
      for(const line of wrap(period,width,8)){page.drawText(line,{x:left,y,size:8,font,color:muted});y-=11;}
      page.drawText(`Result rows: ${rows.length} | Column section ${bandIndex+1} of ${bands.length}`,{x:left,y:y-4,size:9,font,color:ink});y-=23;
      if(band.length){drawCells(headerLines,y,headerHeight,false,true);y-=headerHeight;}
    };
    newPage();
    if(!rows.length)page.drawText("No records matched the selected report.",{x:left,y:y-15,size:10,font,color:ink});
    for(const [rowIndex,row] of rows.entries()){
      const cells=band.map(key=>wrap(row[key]===null||row[key]===undefined?"Not recorded":typeof row[key]==="boolean"?(row[key]?"Yes":"No"):String(row[key]),columnWidth-10));
      const totalLines=Math.max(1,...cells.map(lines=>lines.length));let offset=0;
      while(offset<totalLines){
        if(y-bottom<leading+12)newPage();
        const count=Math.min(totalLines-offset,Math.floor((y-bottom-12)/leading));
        const height=count*leading+12;
        drawCells([[`${rowIndex+1}${offset?"*":""}`],...cells.map(lines=>lines.slice(offset,offset+count))],y,height,rowIndex%2===1);
        y-=height;offset+=count;
      }
    }
  }
  const pages=pdf.getPages();
  for(const [index,p] of pages.entries()){
    p.drawText(`Confidential | Generated ${generated} SAST | * Continued row`,{x:left,y:24,size:7,font,color:muted});
    p.drawText(`${index+1} / ${pages.length}`,{x:width-12,y:24,size:8,font,color:ink});
  }
  return pdf.save();
}
