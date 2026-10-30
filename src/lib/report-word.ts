import { reportBundle } from './report-bundle';
import { DLP_MAX_BYTES } from './dlp-policy';
import type { ReportRow } from './report-data-service';

export const WORD_REPORT_TYPE='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const xml=(value:unknown)=>String(value??'Not recorded').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const label=(key:string)=>key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());
const paragraph=(value:unknown,style='Normal')=>`<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${xml(value).replace(/\r\n|\n|\r/g,'</w:t><w:br/><w:t xml:space="preserve">')}</w:t></w:r></w:p>`;

/** Real editable WordprocessingML: literal text only, no HTML, macros, links or external relationships. */
export function reportWord(title:string,rows:ReportRow[],period:string,columns=Object.keys(rows[0]??{}),generatedAt=new Date().toISOString()) {
  const parts:string[]=[];let bytes=0;
  const append=(part:string)=>{bytes+=Buffer.byteLength(part);if(bytes>DLP_MAX_BYTES-20000)throw new Error('REPORT_LIMIT');parts.push(part);};
  append(paragraph(`STOR24 ${title}`,'Title')+paragraph(period)+paragraph(`Generated ${generatedAt}`)+paragraph('Confidential - authorised recipients only')+paragraph(`${rows.length} result records`));
  const cell=(value:unknown,width:number,header=false)=>`<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/>${header?'<w:shd w:fill="E8EDF2"/>':''}</w:tcPr>${paragraph(value,header?'TableHeading':'Normal')}</w:tc>`;
  const tableRow=(cells:string,values:unknown[])=>`<w:tr>${values.every(v=>String(v??'').length<=500&&String(v??'').split(/\r\n|\n|\r/).length<10)?'<w:trPr><w:cantSplit/></w:trPr>':''}${cells}</w:tr>`;
  const table=(widths:number[])=>`<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(edge=>`<w:${edge} w:val="single" w:sz="4" w:color="D9D9D9"/>`).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(width=>`<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`;
  if(columns.length&&columns.length<=6){
    const width=Math.floor(9360/columns.length);append(table(columns.map(()=>width))+`<w:tr><w:trPr><w:tblHeader/></w:trPr>${columns.map(key=>cell(label(key),width,true)).join('')}</w:tr>`);
    for(const row of rows)append(tableRow(columns.map(key=>cell(row[key],width)).join(''),columns.map(key=>row[key])));
    append('</w:tbl>');
  }else if(columns.length){
    // Labelled records keep every field legible when a report is too wide for one printed table.
    for(const [index,row] of rows.entries()){
      append(paragraph(`Record ${index+1}`,'Heading1')+table([2600,6760]));
      for(const key of columns)append(tableRow(cell(label(key),2600,true)+cell(row[key],6760),[key,row[key]]));
      append('</w:tbl>'+paragraph(''));
    }
  }
  if(!rows.length)append(paragraph('No records matched this report.'));
  const document=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1273" w:bottom="1134" w:left="1273"/></w:sectPr></w:body></w:document>`;
  const styles=`<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="20"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:keepNext/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableHeading"><w:name w:val="Table Heading"/><w:rPr><w:b/></w:rPr></w:style></w:styles>`;
  const files=[
    {name:'[Content_Types].xml',text:'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'},
    {name:'_rels/.rels',text:'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'},
    {name:'word/_rels/document.xml.rels',text:'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
    {name:'word/document.xml',text:document},{name:'word/styles.xml',text:styles},
  ];
  const result=reportBundle(files.map(f=>({name:f.name,bytes:Buffer.from(f.text)})));
  if(result.length>DLP_MAX_BYTES)throw new Error('REPORT_LIMIT');return result;
}
