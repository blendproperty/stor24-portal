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
 def test_local_execution_stops_before_any_subprocess(self):self.refused({'GITHUB_ACTIONS':'false','RUNNER_OS':'Windows'},lane.SUBJECT,'Hosted Linux Actions only')
 def test_unreviewed_subject_stops_before_any_subprocess(self):self.refused({'GITHUB_ACTIONS':'true','RUNNER_OS':'Linux'},'f'*40,'Unreviewed subject/lane identity')
if __name__=='__main__':unittest.main()
