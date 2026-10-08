import hashlib, importlib.util, pathlib, subprocess, tempfile, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('release_verify',pathlib.Path(__file__).with_name('verify-release.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ReleaseVerification(unittest.TestCase):
    def setUp(self):
        self.sha='a'*40
        self.manifest={'schema':1,'repository':module.REPO,'tag':'v0.24.0','commit':self.sha,'sourceArchiveSha256':'c'*64,'checks':[{'workflow':name,'runId':i} for i,name in enumerate(sorted(module.REQUIRED))]}
        self.runs={check['runId']:{'head_sha':self.sha,'head_branch':'main','event':'push','status':'completed','conclusion':'success','path':'.github/workflows/'+check['workflow']} for check in self.manifest['checks']}
    def verify(self):module.validate(self.manifest,'v0.24.0',self.sha,self.runs.get)
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
    def test_missing_or_invalid_signed_source(self):
        for value in ['', 'a'*63, 'g'*64]:
            self.manifest['sourceArchiveSha256']=value
            with self.assertRaises(ValueError):self.verify()
    def test_source_digest_uses_exact_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            def git(*args):return subprocess.check_output(['git','-C',directory,*args],stderr=subprocess.DEVNULL)
            git('init');git('config','user.email','test@example.invalid');git('config','user.name','Test')
            (root/'source.txt').write_text('approved source\n');git('add','.');git('commit','-m','approved')
            sha=git('rev-parse','HEAD').decode().strip()
            expected=hashlib.sha256(git('archive','--format=tar',sha)).hexdigest()
            (root/'source.txt').write_text('different source\n');git('commit','-am','different')
            self.assertEqual(module.source_digest(root,sha),expected)
            self.assertNotEqual(module.source_digest(root,'HEAD'),expected)
    def test_signature_failure_blocks_before_parsing_or_ci_lookup(self):
        with patch.object(module.sys,'argv',['verify-release.py','v0.24.0',self.sha]), patch.object(module,'download',return_value=b'invalid'), patch.object(module,'verify_signature',side_effect=ValueError('Invalid signature')), patch.object(module,'get') as lookup:
            with self.assertRaisesRegex(ValueError,'Invalid signature'):module.main()
            lookup.assert_not_called()
    def test_verifier_failure_cannot_be_ignored(self):
        with patch.object(module,'cosign_binary',return_value='/verified/cosign'), patch.object(module.subprocess,'run',return_value=subprocess.CompletedProcess([],1)) as run:
            with self.assertRaisesRegex(ValueError,'signature'):module.verify_signature(b'{}',b'{}','v0.24.0',self.sha)
            args=run.call_args.args[0]
            self.assertIn('--certificate-identity-regexp',args)
            self.assertIn('--certificate-github-workflow-sha',args)
            self.assertEqual(args[args.index('--certificate-github-workflow-sha')+1],self.sha)
            self.assertFalse(any('insecure' in value or 'ignore' in value for value in args))
if __name__=='__main__':unittest.main()
