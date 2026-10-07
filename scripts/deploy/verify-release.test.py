import importlib.util, pathlib, unittest
spec=importlib.util.spec_from_file_location('release_verify',pathlib.Path(__file__).with_name('verify-release.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ReleaseVerification(unittest.TestCase):
    def setUp(self):
        self.sha='a'*40
        self.manifest={'schema':1,'repository':module.REPO,'tag':'v0.23.0','commit':self.sha,'checks':[{'workflow':name,'runId':i} for i,name in enumerate(sorted(module.REQUIRED))]}
        self.runs={check['runId']:{'head_sha':self.sha,'head_branch':'main','event':'push','status':'completed','conclusion':'success','path':'.github/workflows/'+check['workflow']} for check in self.manifest['checks']}
    def verify(self):module.validate(self.manifest,'v0.23.0',self.sha,self.runs.get)
    def test_success(self):self.verify()
    def test_wrong_commit(self):
        self.runs[0]['head_sha']='b'*40
        with self.assertRaises(ValueError):self.verify()
    def test_failed_or_untrusted_workflow(self):
        self.runs[0]['conclusion']='failure'
        with self.assertRaises(ValueError):self.verify()
        self.runs[0]['conclusion']='success';self.runs[0]['path']='.github/workflows/unrelated.yml'
        with self.assertRaises(ValueError):self.verify()
    def test_missing_gates(self):
        self.manifest['checks'].pop()
        with self.assertRaises(ValueError):self.verify()
if __name__=='__main__':unittest.main()
