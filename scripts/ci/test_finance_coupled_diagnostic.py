"""Preflight-only tests; never execute the financial subject or Docker."""
import importlib.util,json,os,pathlib,sys,unittest
from unittest import mock
runner=pathlib.Path(__file__).with_name('run-finance-coupled-diagnostic.py')
spec=importlib.util.spec_from_file_location('finance_lane',runner);lane=importlib.util.module_from_spec(spec);spec.loader.exec_module(lane)
class Preflight(unittest.TestCase):
 def test_private_data_stripped_and_safe_evidence_retained(self):
  observer={'fixture':'receipt-http-contention','stage':'independent-approval','statusCounts':{'200':1,'409':24,'PRIVATE-SEED':9},'transactionFailures':[{'code':'P2034','startTimeout':False,'expired':False,'elapsedMs':12,'rawSql':'PRIVATE-SQL'}],'routeFailures':[{'code':'P2010','startTimeout':False,'expired':False,'secret':'PRIVATE-TOKEN'}],'credentials':'PRIVATE-TOKEN'}
  raw='PRIVATE-SQL PRIVATE-TOKEN PRIVATE-SEED\n# tests 70\n# pass 61\n# fail 9\n  expected: 200\n  actual: 409\n# '+json.dumps(observer,separators=(',',':'))+'\n'
  summary=lane.sanitized_summary(raw);encoded=json.dumps(summary)
  for value in ['PRIVATE-SQL','PRIVATE-TOKEN','PRIVATE-SEED','rawSql','secret','credentials']:self.assertNotIn(value,encoded)
  self.assertEqual(summary['tapTotals']['fail'],9);self.assertEqual(summary['httpObservers'][0]['stage'],'independent-approval');self.assertEqual(summary['httpObservers'][0]['routeFailures'][0]['code'],'P2010');self.assertEqual(summary['numericAssertionPairs'],[{'expected':200,'actual':409}])
 def refused(self,environment,subject,expected):
  with mock.patch.dict(os.environ,environment),mock.patch.object(lane.subprocess,'run',side_effect=AssertionError('Execution forbidden'))as calls,mock.patch.object(sys,'argv',[str(runner),'--subject','unused','--subject-sha',subject,'--lane-sha','1'*40]):
   with self.assertRaisesRegex(RuntimeError,expected):lane.main()
   calls.assert_not_called()
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
  expected={'receipt-reallocation-workflow':'87ff0b9beedade6869753eae0e24f2ac985546e6ab140574bea2875e1135eab7','finance-raw-rollback':'03419b209cc7225ac877f0c80afb8abaaa6ec22906bc76b9d91b4e3a41921fe4','receipt-import-posting':'fdd2a9db432178d6395a75ca03cb358007248c1f25101bb7a7bc02d7119efa04'}
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
