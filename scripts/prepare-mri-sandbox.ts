/** Preview-first operator repair; never import, post or approve a journal. */
import {readFile} from 'node:fs/promises';
import {prepareMriSandboxMaintenance} from '../src/lib/mri-sandbox-maintenance';
async function main(){
 const args=process.argv.slice(2);if(args.length<1||args.length>2||(args.length===2&&args[1]!=='--apply'))throw Error('MRI_SANDBOX_MAINTENANCE_USAGE');
 const bytes=await readFile(args[0]);if(bytes.length>4096)throw Error('MRI_SANDBOX_MAINTENANCE_INPUT_TOO_LARGE');
 const result=await prepareMriSandboxMaintenance(JSON.parse(bytes.toString()),{apply:args[1]==='--apply'});console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(error instanceof Error&&/^MRI_[A-Z_]+$/.test(error.message)?error.message:'MRI_SANDBOX_MAINTENANCE_REVIEW_REQUIRED');process.exitCode=1});
