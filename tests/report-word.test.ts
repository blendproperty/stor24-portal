import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {SaxesParser} from 'saxes';
import {reportWord} from '../src/lib/report-word';
import {reportBundle} from '../src/lib/report-bundle';
import {DLP_MAX_BYTES} from '../src/lib/dlp-policy';
const JSZip=createRequire(import.meta.url)('jszip');

test('Word is a complete editable OOXML package retaining escaped literal values, Unicode, blanks and all records',async()=>{
  const attack='<w:hyperlink> & "quote"',bytes=reportWord('Synthetic rent review',[{unit:'01',customer:attack,rate:1200.25,unknown:null,flag:false},{unit:'02',customer:'Zoë 日本語',rate:0,unknown:'',flag:true}],'Current snapshot; source basis unchanged',undefined,'2026-10-30T00:00:00.000Z');
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});assert.deepEqual(Object.keys(zip.files).sort(),['[Content_Types].xml','_rels/.rels','word/_rels/document.xml.rels','word/document.xml','word/styles.xml'].sort());
  for(const file of Object.values(zip.files) as {name:string;async:(kind:string)=>Promise<string>}[]){const parser=new SaxesParser({xmlns:true});parser.write(await file.async('string')).close();}
  const xml=await zip.file('word/document.xml').async('string');assert.ok(xml.includes('&lt;w:hyperlink&gt; &amp; &quot;quote&quot;'));assert.ok(xml.includes('Zoë 日本語'));assert.ok(xml.includes('1200.25'));assert.ok(xml.includes('Not recorded'));assert.ok(xml.includes('false'));assert.ok(xml.includes('0'));assert.ok(xml.includes('Current snapshot; source basis unchanged'));assert.ok(xml.includes('2026-10-30T00:00:00.000Z'));assert.ok(xml.includes('<w:tblHeader/>'));assert.ok(!xml.includes('<w:hyperlink>'));assert.ok(!xml.includes('instrText'));
  assert.ok(!(await zip.file('_rels/.rels').async('string')).includes('External'));
  const multiline=await JSZip.loadAsync(reportWord('Notes',[{note:'First line\nSecond line'}],'Source'));const notes=await multiline.file('word/document.xml').async('string');assert.ok(notes.includes('<w:br/>'));assert.ok(notes.includes('<w:cantSplit/>'));
});
test('wide and empty Word reports preserve every selected field and bound expansion',async()=>{
  const row=Object.fromEntries(Array.from({length:25},(_,i)=>[`Column${i}`,i===24?'END MARKER':i]));
  const wide=await JSZip.loadAsync(reportWord('Wide report',[row],'Approved source'));const xml=await wide.file('word/document.xml').async('string');for(let i=0;i<25;i++)assert.ok(xml.includes(`Column${i}`));assert.ok(xml.includes('END MARKER'));assert.ok(xml.includes('Record 1'));
  const empty=await JSZip.loadAsync(reportWord('Empty report',[],'Current snapshot',['Unit','Current rent']));const text=await empty.file('word/document.xml').async('string');assert.ok(text.includes('Current rent'));assert.ok(text.includes('No records matched'));
  assert.throws(()=>reportWord('Too large',[{note:'&'.repeat(DLP_MAX_BYTES)}],'Source'),/REPORT_LIMIT/);
});
test('shared ZIP builder accepts generated OOXML paths and rejects traversal and absolute names',()=>{
  for(const name of ['../secret','word/../../secret','/word/document.xml','C:/secret','word\\secret','word//secret','.','..'])assert.throws(()=>reportBundle([{name,bytes:Buffer.from('x')}]),/INVALID_BUNDLE_NAME/);
});
