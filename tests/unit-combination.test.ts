import test from "node:test";
import assert from "node:assert/strict";
import {adjacentUnitBounds,combinationToken} from "../src/lib/unit-combination";
const a={mapId:"ground",x:0,y:0,width:80,height:100,rotation:0};
test("adjacent full boundaries produce one rectangle",()=>{assert.deepEqual(adjacentUnitBounds(a,{...a,x:80}),{x:0,y:0,width:160,height:100});assert.deepEqual(adjacentUnitBounds(a,{...a,y:100}),{x:0,y:0,width:80,height:200});});
test("diagonal, separated, other-floor and rotated units cannot combine",()=>{for(const b of [{...a,x:100},{...a,x:80,y:50},{...a,x:80,mapId:"upstairs"},{...a,x:80,rotation:90}])assert.throws(()=>adjacentUnitBounds(a,b));});
test("preview token changes when rate, area or unit positions change",()=>{const first=combinationToken({rate:200,area:46,x:0});for(const v of [{rate:201,area:46,x:0},{rate:200,area:47,x:0},{rate:200,area:46,x:1}])assert.notEqual(first,combinationToken(v));});
