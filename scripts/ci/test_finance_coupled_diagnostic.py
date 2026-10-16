"""Preflight-only tests; never execute the financial subject or Docker."""
import importlib.util,json,os,pathlib,sys,unittest
from unittest import mock
runner=pathlib.Path(__file__).with_name('run-finance-coupled-diagnostic.py')
spec=importlib.util.spec_from_file_location('finance_lane',runner);lane=importlib.util.module_from_spec(spec);spec.loader.exec_module(lane)
class Preflight(unittest.TestCase):
 def test_original_default_command_and_explicit_seven_condition_are_exact(self):
  files=['tests/integration/'+name+'.test.ts' for name in ['receipt-reallocation-workflow','adjustments','collections','marketing-payment-cohorts','reservation-price-amendments','finance-raw-rollback','receipt-import-posting']]
  baseline=['node','node_modules/tsx/dist/cli.mjs','--test']+files
  self.assertEqual(lane.diagnostic_command('original-default'),baseline)
  self.assertEqual(lane.diagnostic_command('explicit-seven-files'),baseline[:3]+['--test-concurrency=7']+files)
  self.assertEqual(lane.diagnostic_command('explicit-seven-files').count('--test-concurrency=7'),1)
 def test_unreviewed_condition_cannot_create_command_or_execute_subprocess(self):
  with mock.patch.object(lane.subprocess,'run',side_effect=AssertionError('Execution forbidden')) as calls:
   for value in ['',None,'7','--test-concurrency=8','explicit-eight-files','original-default;unsafe']:
    with self.assertRaisesRegex(RuntimeError,'Unreviewed file-concurrency condition'):lane.diagnostic_command(value)
   calls.assert_not_called()
 def test_private_data_stripped_and_safe_evidence_retained(self):
  observer={'fixture':'receipt-http-contention','stage':'independent-approval','statusCounts':{'200':1,'409':24,'PRIVATE-SEED':9},'transactionFailures':[{'code':'P2034','startTimeout':False,'expired':False,'elapsedMs':12,'rawSql':'PRIVATE-SQL'}],'routeFailures':[{'code':'P2010','startTimeout':False,'expired':False,'secret':'PRIVATE-TOKEN'}],'credentials':'PRIVATE-TOKEN'}
  raw='PRIVATE-SQL PRIVATE-TOKEN PRIVATE-SEED\n# tests 70\n# pass 61\n# fail 9\n  expected: 200\n  actual: 409\n# '+json.dumps(observer,separators=(',',':'))+'\n'
  summary=lane.sanitized_summary(raw);encoded=json.dumps(summary)
  for value in ['PRIVATE-SQL','PRIVATE-TOKEN','PRIVATE-SEED','rawSql','secret','credentials']:self.assertNotIn(value,encoded)
  self.assertEqual(summary['tapTotals']['fail'],9);self.assertEqual(summary['httpObservers'][0]['stage'],'independent-approval');self.assertEqual(summary['httpObservers'][0]['routeFailures'][0]['code'],'P2010');self.assertEqual(summary['numericAssertionPairs'],[{'expected':200,'actual':409}])
 def test_import_observer_closed_evidence_and_private_redaction(self):
  value={'fixture':'receipt-import-contention','case':'same-key-post','stage':'post','errorClasses':['PrismaClientKnownRequestError','PRIVATE-CLASS'],'prismaCodes':['P2034','PRIVATE-CODE'],'sqlStates':['40001','25P02','P2034','ABCDE','PRIVATE-SQL'],'elapsedMs':12,'message':'PRIVATE-SQL','accountId':'PRIVATE-ID'}
  result=lane.sanitized_summary('# '+json.dumps(value,separators=(',',':')))
  self.assertEqual(result['importObservers'],[{'fixture':'receipt-import-contention','case':'same-key-post','stage':'post','errorClasses':['PrismaClientKnownRequestError'],'prismaCodes':['P2034'],'sqlStates':['40001','25P02'],'elapsedMs':12}])
  for private in ['PRIVATE','ABCDE','message','accountId']:self.assertNotIn(private,json.dumps(result))
 def test_import_observer_rejects_unknown_cases_stages_and_malformed_types(self):
  base={'fixture':'receipt-import-contention','case':'move-undo','stage':'undo','errorClasses':['Error'],'prismaCodes':['P2010'],'sqlStates':['40P01'],'elapsedMs':1}
  for change in [{'case':'PRIVATE'},{'stage':'PRIVATE'},{'case':[]},{'stage':{} }]:
   value={**base,**change};self.assertEqual(lane.sanitized_summary(json.dumps(value,separators=(',',':')))['importObservers'],[])
  for change in [{'errorClasses':'PRIVATE','prismaCodes':{},'sqlStates':None,'elapsedMs':True},{'errorClasses':[{}],'prismaCodes':[[]],'sqlStates':[{}],'elapsedMs':float('inf')}]:
   result=lane.sanitized_summary(json.dumps({**base,**change},separators=(',',':')))['importObservers'][0]
   self.assertNotIn('elapsedMs',result)
   self.assertNotIn('PRIVATE',json.dumps(result))
 def test_import_observer_payload_and_count_bounds(self):
  value={'fixture':'receipt-import-contention','case':'netcash-card-return','stage':'netcash-return','errorClasses':['Error'],'prismaCodes':['P2010'],'sqlStates':['P0001'],'elapsedMs':3600000}
  line=json.dumps(value,separators=(',',':'))
  self.assertEqual(len(lane.sanitized_summary('\n'.join([line]*60))['importObservers']),50)
  self.assertEqual(lane.sanitized_summary(line+'PRIVATE'*20000)['importObservers'],[])
  self.assertEqual(lane.sanitized_summary('{"fixture":"receipt-import-contention","case":')['importObservers'],[])
 def refused(self,environment,subject,expected):
  with mock.patch.dict(os.environ,environment),mock.patch.object(lane.subprocess,'run',side_effect=AssertionError('Execution forbidden'))as calls,mock.patch.object(sys,'argv',[str(runner),'--subject','unused','--subject-sha',subject,'--lane-sha','1'*40]):
   with self.assertRaisesRegex(RuntimeError,expected):lane.main()
   calls.assert_not_called()
 def test_safe_case_identity_without_titles_messages_or_private_data(self):
  refs={'Synthetic original case':{'testFile':'receipt-reallocation-workflow.test.ts','sourceLine':54}}
  raw="    not ok 1 - Synthetic original case\n      failureType: 'testCodeFailure'\n      code: 'ERR_REQUIRE_ASYNC_MODULE'\n      error: 'PRIVATE SQL TOKEN SEED'\n    not ok 2 - PRIVATE-CUSTOMER\n      failureType: 'PRIVATE-FAILURE'\n      code: 'PRIVATE-CODE'\n"
  result=lane.sanitized_summary(raw,refs);encoded=json.dumps(result)
  self.assertEqual(result['caseResults'],[{'testFile':'receipt-reallocation-workflow.test.ts','sourceLine':54,'status':'FAIL','failureType':'testCodeFailure','errorCode':'ERR_REQUIRE_ASYNC_MODULE'}]);self.assertEqual(result['unmappedCaseResultCount'],1)
  for private in ['Synthetic original case','PRIVATE','SQL','TOKEN','SEED']:self.assertNotIn(private,encoded)
 def test_ambiguous_nested_and_multiline_cases_remain_safe(self):
  import tempfile
  with tempfile.TemporaryDirectory() as directory:
   paths=[]
   for name in ['receipt-reallocation-workflow','adjustments']:
    path=pathlib.Path(directory)/(name+'.test.ts');path.write_text('test("Duplicate literal",()=>{});\ntest("'+name+' parent",()=>{});\n',encoding='utf-8');paths.append(path)
   refs=lane.subject_case_references(paths);self.assertIsNone(refs['Duplicate literal'])
   raw="    not ok 1 - Duplicate literal\n      failureType: 'testCodeFailure'\nnot ok 2 - receipt-reallocation-workflow parent\n  failureType: 'subtestsFailed'\n  code: 'ERR_TEST_FAILURE'\nnot ok 3 - Escaped\\nPRIVATE-TITLE\nnot ok 4 - Unknown multiline\nPRIVATE-CONTINUATION\n"
   result=lane.sanitized_summary(raw,refs);encoded=json.dumps(result)
   self.assertEqual(result['unresolvedFailureRecordCount'],3);self.assertEqual(len(result['caseResults']),1);self.assertTrue(result['caseResults'][0]['aggregateOnly']);self.assertEqual(result['caseResults'][0]['sourceLine'],2)
   for text in ['Duplicate literal','PRIVATE','Unknown multiline','Escaped']:self.assertNotIn(text,encoded)
 def test_every_malformed_or_oversized_header_breaks_metadata_attribution(self):
  refs={'Known case':{'testFile':'adjustments.test.ts','sourceLine':12}}
  for header in ['not ok 2 - '+'PRIVATE-LONG-'*200,'not ok malformed PRIVATE-HEADER','not ok 2 -','ok bad PRIVATE-PASS']:
   raw="ok 1 - Known case\n"+header+"\n  failureType: 'testCodeFailure'\n  code: 'ERR_ASSERTION'\n"
   result=lane.sanitized_summary(raw,refs)
   self.assertEqual(result['caseResults'],[{'testFile':'adjustments.test.ts','sourceLine':12,'status':'PASS'}]);self.assertEqual(result['unmappedCaseResultCount'],1);self.assertEqual(result['unresolvedFailureRecordCount'],int(header.startswith('not ok')))
   self.assertNotIn('PRIVATE',json.dumps(result))
 def test_fixture_database_matches_unchanged_subject_guards(self):
  # Inspect real runner arguments and exercise the original-guard verifier with
  # synthetic files. No dependency on cwd, Git history, Docker or a DB.
  import ast,tempfile
  tree=ast.parse(runner.read_text(encoding='utf-8'))
  literals=[node.value for node in ast.walk(tree) if isinstance(node,ast.Constant) and isinstance(node.value,str)]
  configured=[value for value in literals if value.startswith('DATABASE_URL=')]
  self.assertEqual(configured,['DATABASE_URL=postgresql://ci:synthetic-ci@localhost:5432/merchandise_ci'])
  self.assertIn('POSTGRES_DB=merchandise_ci',literals);self.assertIn('merchandise_ci',literals)
  with tempfile.TemporaryDirectory() as directory,mock.patch.object(lane.subprocess,'run',side_effect=AssertionError('Execution forbidden')) as calls:
   paths=[pathlib.Path(directory)/(name+'.test.ts') for name in ['receipt-reallocation-workflow','finance-raw-rollback','receipt-import-posting']]
   for path in paths:path.write_text('receipt_correction_[a-z0-9_]+|merchandise_ci',encoding='utf-8')
   lane.verify_subject_database_guards(paths)
   paths[0].write_text('different guard',encoding='utf-8')
   with self.assertRaisesRegex(RuntimeError,'Original database guard changed'):lane.verify_subject_database_guards(paths)
   with self.assertRaisesRegex(RuntimeError,'Missing original guarded suites'):lane.verify_subject_database_guards(paths[1:])
   calls.assert_not_called()
 def test_actual_pinned_subject_guards_from_separate_checkout(self):
  import hashlib,subprocess,tempfile
  expected={'receipt-reallocation-workflow':'87ff0b9beedade6869753eae0e24f2ac985546e6ab140574bea2875e1135eab7','finance-raw-rollback':'03419b209cc7225ac877f0c80afb8abaaa6ec22906bc76b9d91b4e3a41921fe4','receipt-import-posting':'c9829ecaced0da7da594640543ceeb3e7f5aa038ea5c02d1ef3fdbafb74db42e'}
  configured=os.environ.get('FINANCE_DIAGNOSTIC_SUBJECT_DIRECTORY')
  if os.environ.get('GITHUB_ACTIONS')=='true':
   self.assertIsNotNone(configured,'Hosted preflight requires the separate literal-pinned subject checkout')
   self.assertEqual(pathlib.Path(configured).resolve(),pathlib.Path(os.environ['GITHUB_WORKSPACE']).resolve()/'subject')
  with tempfile.TemporaryDirectory() as directory:
   paths=[]
   for name,digest in expected.items():
    relative='tests/integration/'+name+'.test.ts'
    if configured:payload=(pathlib.Path(configured)/relative).read_bytes()
    else:payload=subprocess.check_output(['git','-C',str(runner.resolve().parents[2]),'show',lane.SUBJECT+':'+relative])
    self.assertEqual(hashlib.sha256(payload).hexdigest(),digest)
    path=pathlib.Path(directory)/(name+'.test.ts');path.write_bytes(payload);paths.append(path)
   lane.verify_subject_database_guards(paths)
 def test_local_execution_stops_before_any_subprocess(self):self.refused({'GITHUB_ACTIONS':'false','RUNNER_OS':'Windows'},lane.SUBJECT,'Hosted Linux Actions only')
 def test_unreviewed_subject_stops_before_any_subprocess(self):self.refused({'GITHUB_ACTIONS':'true','RUNNER_OS':'Linux'},'f'*40,'Unreviewed subject/lane identity')
if __name__=='__main__':unittest.main()
