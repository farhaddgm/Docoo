"""Wait for successful main-branch gates on the exact release commit."""
import hashlib, json, os, pathlib, subprocess, time, urllib.request
REQUIRED = ['ci.yml', 'security.yml', 'hardening.yml', 'deploy-smoke.yml']
repo = os.environ['GITHUB_REPOSITORY']
sha = os.environ['GITHUB_SHA']
token = os.environ['GITHUB_TOKEN']
def get(path):
    request = urllib.request.Request('https://api.github.com/repos/'+repo+'/'+path,
        headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'})
    with urllib.request.urlopen(request,timeout=20) as response: return json.load(response)
version = json.loads(pathlib.Path('package.json').read_text())['version']
for attempt in range(180):
    evidence=[]
    for workflow in REQUIRED:
        runs=get(f'actions/workflows/{workflow}/runs?head_sha={sha}&event=push&per_page=20')['workflow_runs']
        runs=[run for run in runs if run['head_sha']==sha and run['head_branch']=='main']
        if not runs: break
        run=max(runs,key=lambda value:value['id'])
        if run['status']!='completed': break
        if run['conclusion']!='success': raise SystemExit('Release blocked: '+workflow+' did not pass.')
        evidence.append({'workflow':workflow,'runId':run['id']})
    if len(evidence)==len(REQUIRED):
        digest=hashlib.sha256()
        with subprocess.Popen(['git','archive','--format=tar',sha],stdout=subprocess.PIPE) as process:
            for chunk in iter(lambda:process.stdout.read(1024*1024),b''): digest.update(chunk)
            if process.wait()!=0: raise SystemExit('Release blocked: source archive failed.')
        pathlib.Path('security-gate.json').write_text(json.dumps({'schema':1,'repository':repo,'tag':'v'+version,'commit':sha,'sourceArchiveSha256':digest.hexdigest(),'checks':evidence},indent=2)+'\n')
        print('All release gates passed on the exact main commit.');break
    time.sleep(20)
else: raise SystemExit('Release blocked: gates did not finish before the deadline.')
