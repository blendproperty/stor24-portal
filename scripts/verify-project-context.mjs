import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const normalize=text=>text.replace(/^\uFEFF/,"").replaceAll("\r\n","\n");
/** Catastrophic-truncation guard, not proof of semantic history preservation.
 * Promotion still requires complete original/owned text and Git blob checks. */
export function verifyProjectContext(current,baseline){
  const text=normalize(current),bytes=Buffer.byteLength(text),lines=text.split("\n").length;
  if(/^[ \t]*(?:<{7}|={7}|>{7}|\|{7})(?:[ \t]|$)/m.test(text))throw Error("PROJECT_CONTEXT.md contains unresolved Git conflict markers. Resolve and verify the complete retained history before promotion.");
  if(bytes<100000||lines<100||!/^# STOR 24 CRM and Operations Platform\b/m.test(text))throw Error("PROJECT_CONTEXT.md appears truncated or is missing its canonical identity. Restore the complete Git history before promotion.");
  const baseBytes=baseline===undefined?null:Buffer.byteLength(normalize(baseline));
  if(baseBytes!==null&&baseBytes>=100000&&bytes<baseBytes*0.9)throw Error("PROJECT_CONTEXT.md lost more than 10% of its base text. Verify complete retained history before promotion.");
  return {bytes,lines,baseBytes};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==="--base"))throw Error("Usage: node scripts/verify-project-context.mjs [--base Git-ref]");
    let baseline;
    if(args.length){const result=spawnSync("git",["show",`${args[1]}:PROJECT_CONTEXT.md`],{encoding:"utf8",maxBuffer:16*1024*1024});if(result.error||result.status!==0||!result.stdout)throw Error("Cannot read the requested base canonical Git blob; preservation verification stopped.");baseline=result.stdout;}
    console.log(JSON.stringify({projectContextPreservation:verifyProjectContext(readFileSync("PROJECT_CONTEXT.md","utf8"),baseline)}));
  }catch(error){console.error(error instanceof Error?error.message:"Canonical context verification failed.");process.exitCode=1;}
}
