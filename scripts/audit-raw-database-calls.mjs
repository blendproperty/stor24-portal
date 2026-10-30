import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Static inventory only: this does not evaluate application code or authorize grants.
const schema = readFileSync('prisma/schema.prisma','utf8');
const names = new Map();
for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const table = /@@map\("([^"]+)"\)/.exec(match[2])?.[1] || match[1];
  names.set(table.toLowerCase(), table);
}
names.set('_prisma_migrations','_prisma_migrations');
const result = [];
function walk(dir) {
  for (const entry of readdirSync(dir,{withFileTypes:true})) {
    if (entry.name === 'generated' || entry.name === 'node_modules') continue;
    const file=join(dir,entry.name);
    if (entry.isDirectory()) { walk(file); continue; }
    if (!/\.(?:ts|tsx|js|mjs)$/.test(file)) continue;
    const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const found=[];
    function visit(node) {
      const raw = (ts.isTaggedTemplateExpression(node) && node.tag.getText(source).match(/\.\$(?:queryRaw|executeRaw)(?:Unsafe)?$/)) ||
        (ts.isCallExpression(node) && node.expression.getText(source).match(/\.\$(?:queryRaw|executeRaw)(?:Unsafe)?$/));
      if (raw) {
        const text=node.getText(source), tables=new Map();
        const rowLock=/\bFOR\s+(?:(?:NO\s+KEY|KEY)\s+)?(?:UPDATE|SHARE)\b/i.test(text);
        for (const m of text.matchAll(/\b(DELETE\s+FROM|INSERT\s+INTO|UPDATE|FROM|JOIN)\s+(?:"?public"?\s*\.\s*)?"?([A-Za-z_][A-Za-z_0-9]*)"?/gi)) {
          const table=names.get(m[2].toLowerCase()); if (!table) continue;
          const verb=m[1].toUpperCase(); const op=verb==='FROM'||verb==='JOIN'?'SELECT':verb.startsWith('DELETE')?'DELETE':verb.startsWith('INSERT')?'INSERT':'UPDATE';
          if(!tables.has(table)) tables.set(table,new Set()); tables.get(table).add(op);
          // PostgreSQL row-locking SELECTs also require UPDATE privilege; joins may overstate the affected tables.
          if (rowLock && op === 'SELECT') tables.get(table).add('UPDATE');
          // Conflict updates and RETURNING require additional privileges on the target.
          if (op === 'INSERT' && /\bON\s+CONFLICT\b[\s\S]*\bDO\s+UPDATE\b/i.test(text)) { tables.get(table).add('UPDATE'); tables.get(table).add('SELECT'); }
          if (['INSERT','UPDATE','DELETE'].includes(op) && /\bRETURNING\b/i.test(text)) tables.get(table).add('SELECT');
        }
        const functions=[...new Set([...text.matchAll(/\b(pg_advisory_xact_lock|hashtextextended|pg_try_advisory_xact_lock|pg_advisory_lock|pg_advisory_unlock)\s*\(/gi)].map(m=>m[1].toLowerCase()))].sort();
        found.push({line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,method:raw[0].slice(1),interpolated:ts.isTaggedTemplateExpression(node) ? ts.isTemplateExpression(node.template) : node.arguments.some(a=>!ts.isStringLiteralLike(a)),rowLock,tables:[...tables.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([table,ops])=>({table,operations:[...ops].sort()})),functions});
      }
      ts.forEachChild(node,visit);
    }
    visit(source); if(found.length)result.push({file:relative('.',file).replaceAll('\\','/'),calls:found});
  }
}
walk('src'); result.sort((a,b)=>a.file.localeCompare(b.file));
console.log(JSON.stringify({source:'non-generated src; static syntax inventory only',modelTables:names.size,files:result.length,calls:result.reduce((n,f)=>n+f.calls.length,0),filesWithInterpolationOrNonliteral:result.filter(f=>f.calls.some(c=>c.interpolated)).length,results:result},null,2));
