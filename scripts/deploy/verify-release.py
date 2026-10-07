"""Validate GitHub release evidence before checking out/building an update."""
import json, re, sys, urllib.request
REPO='farhaddgm/Docoo'
REQUIRED={'ci.yml','security.yml','hardening.yml','deploy-smoke.yml'}
def get(url):
    request=urllib.request.Request(url,headers={'Accept':'application/vnd.github+json','User-Agent':'Docoo-Release-Verifier'})
    with urllib.request.urlopen(request,timeout=20) as response:
        body=response.read(1_000_001)
        if len(body)>1_000_000: raise ValueError('Oversized release evidence')
        return json.loads(body)
def validate(manifest,tag,sha,lookup):
    if manifest.get('schema')!=1 or manifest.get('repository')!=REPO or manifest.get('tag')!=tag or manifest.get('commit')!=sha: raise ValueError('Release evidence does not match the requested commit')
    checks=manifest.get('checks',[])
    if len(checks)!=len(REQUIRED) or {check.get('workflow') for check in checks}!=REQUIRED: raise ValueError('Missing release gates')
    for check in checks:
        if type(check.get('runId')) is not int: raise ValueError('Invalid gate ID')
        run=lookup(check['runId'])
        if (run.get('head_sha')!=sha or run.get('head_branch')!='main' or run.get('event')!='push' or run.get('status')!='completed' or run.get('conclusion')!='success' or run.get('path')!='.github/workflows/'+check['workflow']): raise ValueError('Release gate has not passed for this main commit')
def main():
    tag,sha=sys.argv[1:]
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+',tag) or not re.fullmatch(r'[0-9a-f]{40}',sha): raise ValueError('Invalid release identity')
    manifest=get(f'https://github.com/{REPO}/releases/download/{tag}/security-gate.json')
    validate(manifest,tag,sha,lambda run_id:get(f'https://api.github.com/repos/{REPO}/actions/runs/{run_id}'))
    print('Release evidence verified: '+tag)
if __name__=='__main__':
    try: main()
    except Exception as error: raise SystemExit('Update blocked: '+str(error))
