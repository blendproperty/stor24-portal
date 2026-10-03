import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const load = createRequire(import.meta.url);
const braces = load("braces");
const caller = createRequire(load.resolve("micromatch"));
function ast(depth: number) { let node: {type:string;value?:string;nodes?:unknown[]} = {type:"text",value:"a"}; for(let i=0;i<depth;i++) node={type:"brace",nodes:[node]}; return {type:"root",nodes:[node]}; }
test("actual glob caller loads the locally patched package",()=>{
 assert.equal(caller("braces/package.json").version,"3.0.4-stor24.1");
 assert.equal(load("braces/package.json").version,"3.0.4-stor24.1");
 assert.throws(()=>caller("braces").compile(ast(3000)),/exceeds max depth/);
});
test("all public string and AST routes bound nesting",()=>{
 for(const input of ["{".repeat(101)+"a,b"+"}".repeat(101),"(".repeat(101)+"a"+")".repeat(101),"{(".repeat(51)+"a,b"+")}".repeat(51),"{".repeat(101)]){
  for(const method of ["parse","compile","expand","stringify"]) assert.throws(()=>braces[method](input),/exceeds max depth/);
 }
 for(const method of ["compile","expand","stringify"]) assert.throws(()=>braces[method](ast(3000)),/exceeds max depth/);
 assert.doesNotThrow(()=>braces.parse("{".repeat(100)+"a,b"+"}".repeat(100)));
 for(const maxDepth of [1,1.5]) assert.throws(()=>braces.parse("{{a,b},c}",{maxDepth}),/exceeds max depth/);
 for(const maxDepth of [101,Infinity,NaN]) assert.throws(()=>braces.parse("{".repeat(101)+"a,b"+"}".repeat(101),{maxDepth}),/exceeds max depth/);
});
test("ordinary ranges, alternatives, escaped text and stringify stay compatible",()=>{
 assert.deepEqual(braces.expand("unit-{1..3}"),["unit-1","unit-2","unit-3"]);
 assert.deepEqual(braces.expand("{a,{b,c}}"),["a","b","c"]);
 assert.equal(braces.stringify(braces.parse("{a,b}")),"{a,b}");
 const value=String.raw`\{literal\}`; assert.equal(braces.stringify(braces.parse(value,{keepEscaping:true})),value);
 assert.equal(braces.stringify(braces.parse("{a}"),{escapeInvalid:true}),"{a}");
 assert.doesNotThrow(()=>braces.parse('"'+"{".repeat(150)+'"'));
});
