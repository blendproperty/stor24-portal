"""One approved hosted diagnostic; never run against laptop/production Docker."""
import argparse, datetime, hashlib, json, os, pathlib, re, subprocess, time
SUBJECT='f385f9044f471ed46542619a83c93341e41e49da'
OBSERVER='87ff0b9beedade6869753eae0e24f2ac985546e6ab140574bea2875e1135eab7'
TESTS=['receipt-reallocation-workflow','adjustments','collections','marketing-payment-cohorts','reservation-price-amendments','finance-raw-rollback','receipt-import-posting']
CONDITIONS=('original-default','explicit-seven-files')
def diagnostic_command(condition):
 if condition not in CONDITIONS:raise RuntimeError('Unreviewed file-concurrency condition')
 return ['node','node_modules/tsx/dist/cli.mjs','--test']+(['--test-concurrency=7'] if condition=='explicit-seven-files' else [])+['tests/integration/'+name+'.test.ts' for name in TESTS]
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def command(args,**kwargs):return subprocess.run(args,check=True,capture_output=True,text=True,**kwargs).stdout.strip()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
STAGES={'initial-authentication','initial-workspace','initial-preview','foreign-origin-denial','reviewer-request-denial','contention-previews','contention-requests','requester-approval-denial','foreign-approval-denial','independent-approval','approval-idempotent-retry','source-document','foreign-document-denial','foreign-workspace-denial','next-preview','raw-rollback-40001','raw-rollback-40P01','current-grant-revocation','original-financial-baselines'}
def subject_case_references(paths):
 # Only literal titles from these exact, previously Git/hash-verified sources
 # become lookup keys. Published identifiers contain basename/line, not titles.
 references={}
 for path in paths:
  if path.name not in {name+'.test.ts' for name in TESTS}:raise RuntimeError('Unselected diagnostic source')
  for number,line in enumerate(path.read_text(encoding='utf-8').splitlines(),1):
   match=re.search(r"\b(?:test|t\.test)\(\s*(['\"])(.*?)\1",line)
   if match:
    title=match[2]
    reference={'testFile':path.name,'sourceLine':number}
    references[title]=None if title in references else reference
 return references
def sanitized_summary(raw,case_references=None):
 result={'tapTotals':{},'httpObservers':[],'observedPrismaCodes':sorted(set(re.findall(r"\bP[0-9]{4}\b",raw)))[:100],'numericAssertionPairs':[],'rawContentPublished':False,'caseResults':[],'unmappedCaseResultCount':0,'unresolvedFailureRecordCount':0};pending=None;current_case=None
 for line in raw.splitlines():
  header=re.match(r'^\s*(not ok|ok)\b',line)
  if header:
   # Every TAP-like result boundary clears the previous record, including
   # malformed/oversized unknown titles. Never attach later failure metadata
   # to a preceding known case merely because this header could not resolve.
   current_case=None
   case=re.match(r'^\s*(not ok|ok) [0-9]+ - (.{1,2000})$',line) if len(line)<=2200 else None
   reference=(case_references or {}).get(case[2]) if case else None
   if reference and len(result['caseResults'])<400:
    current_case={**reference,'status':'FAIL' if header[1]=='not ok' else 'PASS'};result['caseResults'].append(current_case)
   else:
    result['unmappedCaseResultCount']+=1
    if header[1]=='not ok':result['unresolvedFailureRecordCount']+=1
  if current_case is not None:
   kind=re.match(r"^\s*failureType: ['\"]?([A-Za-z]+)['\"]?\s*$",line)
   if kind and kind[1] in {'testCodeFailure','subtestsFailed','cancelledByParent','hookFailed','testTimeoutFailure','uncaughtException','unhandledRejection'}:current_case['failureType']=kind[1]
   code=re.match(r"^\s*code: ['\"]?([A-Z0-9_]+)['\"]?\s*$",line)
   if code and (re.fullmatch(r'P[0-9]{4}',code[1]) or code[1] in {'ERR_ASSERTION','ERR_TEST_FAILURE','EACCES','ENOENT','EROFS','ERR_MODULE_NOT_FOUND','ERR_REQUIRE_ASYNC_MODULE','ERR_REQUIRE_ESM','ERR_UNKNOWN_FILE_EXTENSION'}):current_case['errorCode']=code[1]
  total=re.search(r'^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([0-9]+(?:\.[0-9]+)?)$',line.strip())
  if total:result['tapTotals'][total[1]]=float(total[2])
  if current_case is not None and current_case.get('failureType')=='subtestsFailed':current_case['aggregateOnly']=True
  number=re.search(r'^\s*(expected|actual): ([0-9]{1,4})\s*$',line)
  if number:
   if number[1]=='expected':pending=int(number[2])
   elif pending is not None:result['numericAssertionPairs'].append({'expected':pending,'actual':int(number[2])});pending=None
  marker=line.find('{"fixture":"receipt-http-contention"')
  if marker<0 or len(line)>100000:continue
  try:
   value=json.JSONDecoder().raw_decode(line[marker:])[0]
   if value.get('fixture')!='receipt-http-contention' or value.get('stage') not in STAGES:continue
   observer={'fixture':'receipt-http-contention','stage':value['stage'],'statusCounts':{}}
   for code,count in value.get('statusCounts',{}).items():
    if re.fullmatch('[1-5][0-9]{2}',code) and type(count)is int and 0<=count<=100000:observer['statusCounts'][code]=count
   for kind in ['transactionFailures','routeFailures']:
    observer[kind]=[]
    for row in value.get(kind,[])[:1000]:
     if not isinstance(row,dict):continue
     clean={'code':row.get('code') if re.fullmatch(r'P[0-9]{4}|NONE|UNKNOWN|UNCLASSIFIED',str(row.get('code'))) else 'UNCLASSIFIED'}
     for key in ['startTimeout','expired']:
      if type(row.get(key))is bool:clean[key]=row[key]
     if type(row.get('elapsedMs'))in [int,float] and 0<=row['elapsedMs']<=600000:clean['elapsedMs']=row['elapsedMs']
     observer[kind].append(clean)
   if len(result['httpObservers'])<50:result['httpObservers'].append(observer)
  except (ValueError,TypeError,AttributeError):pass
 result['numericAssertionPairs']=result['numericAssertionPairs'][:100]
 return result
def verify_subject_database_guards(paths):
 # Run after pinned original bytes are verified, before any Docker call.
 # No Git subprocess or caller working-directory assumption in this check.
 guarded={'receipt-reallocation-workflow.test.ts','finance-raw-rollback.test.ts','receipt-import-posting.test.ts'}
 selected={path.name:path for path in paths if path.name in guarded}
 if set(selected)!=guarded:raise RuntimeError('Missing original guarded suites')
 for path in selected.values():
  if 'receipt_correction_[a-z0-9_]+|merchandise_ci' not in path.read_text(encoding='utf-8'):raise RuntimeError('Original database guard changed')
 if not re.fullmatch(r'/(?:receipt_correction_[a-z0-9_]+|merchandise_ci)','/merchandise_ci'):raise RuntimeError('Diagnostic database guard mismatch')
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--subject',required=True);parser.add_argument('--subject-sha',required=True);parser.add_argument('--lane-sha',required=True);parser.add_argument('--condition',choices=CONDITIONS,default='original-default');args=parser.parse_args()
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('RUNNER_OS')!='Linux':raise RuntimeError('Hosted Linux Actions only; local execution refused')
 if args.subject_sha!=SUBJECT or not re.fullmatch('[a-f0-9]{40}',args.lane_sha):raise RuntimeError('Unreviewed subject/lane identity')
 workspace=pathlib.Path(os.environ['GITHUB_WORKSPACE']).resolve();subject=pathlib.Path(args.subject).resolve();lane=pathlib.Path(__file__).resolve().parents[2]
 if subject!=workspace/'subject' or lane!=workspace/'lane':raise RuntimeError('Expected separate owned checkouts')
 if command(['git','-C',str(subject),'rev-parse','HEAD'])!=SUBJECT or command(['git','-C',str(lane),'rev-parse','HEAD'])!=args.lane_sha:raise RuntimeError('Checkout identity changed')
 command(['git','-C',str(subject),'diff','--exit-code']);command(['git','-C',str(subject),'diff','--cached','--exit-code'])
 if any((subject/name).exists() for name in ['.env','.env.local','.env.production','.env.test']):raise RuntimeError('Local environment files refused')
 paths=[subject/'tests/integration'/f'{name}.test.ts' for name in TESTS]
 for path in paths:
  original=subprocess.check_output(['git','-C',str(subject),'show',SUBJECT+':'+str(path.relative_to(subject))]);assert path.read_bytes()==original,'Selected test bytes changed'
 if sha(paths[0])!=OBSERVER:raise RuntimeError('Original reviewed observer changed')
 verify_subject_database_guards(paths)
 run=os.environ['GITHUB_RUN_ID'];attempt=os.environ['GITHUB_RUN_ATTEMPT']
 if not re.fullmatch('[0-9]+',run) or not re.fullmatch('[0-9]+',attempt):raise RuntimeError('Invalid owned run identity')
 identity=run+'-'+attempt;prefix='stor24-finance-diag-'+identity;label='stor24.finance.diagnostic.owner';network=prefix+'-net';postgres=prefix+'-pg'
 output=workspace/'output'/'finance-coupled'/identity;output.mkdir(parents=True,exist_ok=False);test_output=output/'fixture-output';test_output.mkdir();(subject/'output').mkdir(exist_ok=True)
 manifest={'startedAt':now(),'laneSha':args.lane_sha,'subjectSha':SUBJECT,'testHashes':{str(p.relative_to(subject)):sha(p) for p in paths},'observerHash':OBSERVER,'platform':'isolated hosted Linux; historical Windows environment differs','providerOrProductionSecretsProvided':False,'productionOrProviderAction':False,'assertionsOrInnerTimeoutsChanged':False,'command':diagnostic_command(args.condition),'condition':args.condition,'maximumFileConcurrencyRequested':7 if args.condition=='explicit-seven-files' else None,'originalDefaultCommandPreserved':args.condition=='original-default','fileWorkerConcurrencyActuallyObserved':False,'historicalEnvironmentReplication':False,'runs':[]}
 def retain(): (output/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
 retain();resources=[];result=1
 def owned_remove(kind,name):
  value=command(['docker',kind,'inspect','--format','{{ index .Config.Labels "'+label+'" }}' if kind=='container' else '{{ index .Labels "'+label+'" }}',name])
  if value!=identity:raise RuntimeError('Cleanup ownership mismatch; resource preserved')
  subprocess.run(['docker', 'rm','-f',name] if kind=='container' else ['docker','network','rm',name],check=True,capture_output=True)
 try:
  manifest['phase']='pull-public-images';retain()
  for image in ['postgres:16','node:22-bookworm']:command(['docker','pull',image],timeout=180)
  manifest['images']={name:command(['docker','image','inspect','--format','{{.Id}}',name]) for name in ['postgres:16','node:22-bookworm']};retain()
  manifest['phase']='create-owned-internal-network';retain()
  command(['docker','network','create','--internal','--label',label+'='+identity,network]);resources.append(('network',network))
  if command(['docker','network','inspect','--format','{{.Internal}}',network])!='true':raise RuntimeError('Private network required')
  manifest['networkInternalVerified']=True;manifest['testNetworkNamespace']='owned PostgreSQL only';retain()
  manifest['phase']='start-owned-postgres';retain()
  command(['docker','run','-d','--name',postgres,'--network',network,'--label',label+'='+identity,'-e','POSTGRES_USER=ci','-e','POSTGRES_PASSWORD=synthetic-ci','-e','POSTGRES_DB=merchandise_ci','postgres:16','-c','log_error_verbosity=verbose']);resources.append(('container',postgres))
  if command(['docker','port',postgres]):raise RuntimeError('Host port exposure refused')
  manifest['noHostPortsVerified']=True;retain()
  manifest['phase']='postgres-startup-readiness';retain()
  for _ in range(60):
   if subprocess.run(['docker','exec',postgres,'pg_isready','-U','ci','-d','merchandise_ci'],capture_output=True).returncode==0:break
   time.sleep(1)
  else:raise RuntimeError('Own synthetic PostgreSQL did not become ready')
  def node_container(name,extra,program):
   resources.append(('container',name))
   return ['docker','run','--name',name,'--network','container:'+postgres,'--label',label+'='+identity,'--workdir','/workspace','--mount','type=bind,source='+str(subject)+',target=/workspace,readonly','--mount','type=bind,source='+str(test_output)+',target=/workspace/output','-e','DATABASE_URL=postgresql://ci:synthetic-ci@localhost:5432/merchandise_ci','-e','MERCHANDISE_DB_TEST=isolated-ci','-e','TSX_DISABLE_CACHE=1']+extra+['node:22-bookworm']+program
  manifest['phase']='runtime-compatibility-preflight';retain()
  manifest['runtime']=json.loads(command(node_container(prefix+'-runtime',[],['node','-e',"console.log(JSON.stringify({node:process.version,arch:process.arch,parallelism:require('node:os').availableParallelism(),nodeOptionsConfigured:!!process.env.NODE_OPTIONS,opensslCli:require('node:child_process').execFileSync('openssl',['version']).toString().trim()}))"])));manifest['defaultFileConcurrencyContractInference']=max(1,manifest['runtime']['parallelism']-1) if args.condition=='original-default' and not manifest['runtime']['nodeOptionsConfigured'] else None;retain()
  manifest['phase']='bootstrap-own-empty-database';retain()
  with (output/'_private-bootstrap.log').open('w',encoding='utf-8') as log:
   boot=subprocess.run(node_container(prefix+'-bootstrap',['-e','ALLOW_EMPTY_DATABASE_BOOTSTRAP=true'],['node','scripts/bootstrap-empty-database.mjs']),stdout=log,stderr=subprocess.STDOUT,timeout=180)
  manifest['bootstrapExitCode']=boot.returncode;retain()
  if boot.returncode:raise RuntimeError('Owned empty-database bootstrap failed; workload not started')
  manifest['phase']='single-original-coupled-workload';manifest['emptyDatabaseBootstrappedOnce']=True;manifest['workloadStartedAt']=now();retain()
  with (output/'_private-coupled.tap.log').open('w',encoding='utf-8') as log:
   test=subprocess.run(node_container(prefix+'-workload',[],manifest['command']),stdout=log,stderr=subprocess.STDOUT,timeout=600)
  result=test.returncode;manifest['workloadExitCode']=result;manifest['workloadCompletedAt']=now();manifest['coupledLogSha256']=sha(output/'_private-coupled.tap.log');retain()
 except BaseException as error:
  manifest['diagnosticFailureClass']=type(error).__name__;manifest['diagnosticFailureStage']=manifest.get('phase','preflight');retain();raise
 finally:
  try:
   for private_name in ['_private-bootstrap.log','_private-coupled.tap.log']:
    private=output/private_name
    if private.exists():
     manifest[private_name]={'bytes':private.stat().st_size,'sha256':sha(private),'published':False}
     if private_name=='_private-bootstrap.log':manifest['bootstrapSafeCodes']=sanitized_summary(private.read_text(encoding='utf-8',errors='replace'))['observedPrismaCodes']
     if private_name=='_private-coupled.tap.log':(output/'diagnostic-summary.json').write_text(json.dumps(sanitized_summary(private.read_text(encoding='utf-8',errors='replace'),subject_case_references(paths)),indent=2),encoding='utf-8')
     private.unlink()
   if ('container',postgres) in resources:
    pg=subprocess.run(['docker','logs','--timestamps',postgres],capture_output=True,text=True)
    states=re.findall(r'(?:ERROR|FATAL):\s+([0-9A-Z]{5}):',pg.stdout+'\n'+pg.stderr)
    (output/'postgres-sqlstates.json').write_text(json.dumps({'nativeSqlstates':states[:5000],'truncated':len(states)>5000,'notMappedToSpecificHttpFailure':True}),encoding='utf-8')
  finally:
   cleanup=[]
   for kind,name in reversed(resources):
    try:owned_remove(kind,name);cleanup.append({'kind':kind,'ownedRemoved':True})
    except BaseException as error:cleanup.append({'kind':kind,'ownedRemoved':False,'errorClass':type(error).__name__});result=1
   manifest['cleanup']=cleanup;manifest['completedAt']=now();retain()
 if any(not row['ownedRemoved'] for row in manifest['cleanup']):raise RuntimeError('Owned cleanup incomplete; inspect retained metadata')
 return result
if __name__=='__main__':
 try:raise SystemExit(main())
 except Exception as error:
  print(json.dumps({'diagnosticFailureClass':type(error).__name__,'result':'NOT_CLEARED','rawErrorPublished':False}));raise SystemExit(1)
