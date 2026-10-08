"""Verify the release signature, source and CI before checking out/building an update."""
import hashlib, json, os, pathlib, platform, re, subprocess, sys, tempfile, time, urllib.request
REPO='farhaddgm/Docoo'
REQUIRED={'ci.yml','security.yml','hardening.yml','deploy-smoke.yml'}
COSIGN_VERSION='v3.1.3'
COSIGN_HASHES={
    'amd64':'4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71',
    'arm64':'c5d324e091826b0d7a78eb16fef316450b4eb9aaec045611c08ba06f5e73220a',
}
def download(url,limit=1_000_000):
    request=urllib.request.Request(url,headers={'User-Agent':'Docoo-Release-Verifier'})
    with urllib.request.urlopen(request,timeout=20) as response:
        body=response.read(limit+1)
        if len(body)>limit: raise ValueError('Oversized release evidence')
        return body
def get(url): return json.loads(download(url))
def sha256_file(path):
    digest=hashlib.sha256()
    with open(path,'rb') as source:
        for chunk in iter(lambda:source.read(1024*1024),b''): digest.update(chunk)
    return digest.hexdigest()
def cosign_binary():
    architecture={'x86_64':'amd64','aarch64':'arm64'}.get(platform.machine())
    if platform.system()!='Linux' or not architecture: raise ValueError('Release verification requires Linux amd64 or arm64')
    cache=pathlib.Path.home()/'.cache'/'docoo-release-verifier'
    cache.mkdir(parents=True,exist_ok=True,mode=0o700)
    if cache.is_symlink() or cache.stat().st_uid!=os.geteuid(): raise ValueError('Untrusted verifier cache')
    cache.chmod(0o700)
    binary=cache/f'cosign-{COSIGN_VERSION}-{architecture}'
    if not binary.exists():
        request=urllib.request.Request(f'https://github.com/sigstore/cosign/releases/download/{COSIGN_VERSION}/cosign-linux-{architecture}',headers={'User-Agent':'Docoo-Release-Verifier'})
        with tempfile.NamedTemporaryFile(dir=cache,delete=False) as target:
            temporary=pathlib.Path(target.name)
            try:
                size=0;deadline=time.monotonic()+120
                with urllib.request.urlopen(request,timeout=30) as response:
                    while True:
                        chunk=response.read(1024*1024)
                        if not chunk: break
                        size+=len(chunk)
                        if size>200*1024*1024 or time.monotonic()>deadline: raise ValueError('Verifier download exceeded its limit')
                        target.write(chunk)
                target.flush()
                if sha256_file(temporary)!=COSIGN_HASHES[architecture]: raise ValueError('Verifier checksum mismatch')
                temporary.chmod(0o755);temporary.replace(binary)
            finally: temporary.unlink(missing_ok=True)
    if sha256_file(binary)!=COSIGN_HASHES[architecture]: raise ValueError('Verifier checksum mismatch')
    return str(binary)
def verify_signature(manifest,bundle,tag,sha):
    identity=r'^https://github\.com/farhaddgm/Docoo/\.github/workflows/release\.yml@refs/(heads/main|tags/'+re.escape(tag)+r')$'
    with tempfile.TemporaryDirectory(prefix='docoo-release-') as temporary:
        directory=pathlib.Path(temporary)
        (directory/'manifest.json').write_bytes(manifest)
        (directory/'bundle.json').write_bytes(bundle)
        result=subprocess.run([cosign_binary(),'verify-blob','--bundle',str(directory/'bundle.json'),
            '--certificate-identity-regexp',identity,'--certificate-oidc-issuer','https://token.actions.githubusercontent.com',
            '--certificate-github-workflow-sha',sha,str(directory/'manifest.json')],capture_output=True,timeout=90)
        if result.returncode: raise ValueError('Release signature or workflow identity is invalid')
def source_digest(root,sha):
    digest=hashlib.sha256()
    with subprocess.Popen(['git','-C',str(root),'archive','--format=tar',sha],stdout=subprocess.PIPE,stderr=subprocess.PIPE) as process:
        for chunk in iter(lambda:process.stdout.read(1024*1024),b''): digest.update(chunk)
        if process.wait()!=0: raise ValueError('Cannot verify the requested source archive')
    return digest.hexdigest()
def validate(manifest,tag,sha,lookup):
    if manifest.get('schema')!=1 or manifest.get('repository')!=REPO or manifest.get('tag')!=tag or manifest.get('commit')!=sha: raise ValueError('Release evidence does not match the requested commit')
    if not re.fullmatch(r'[0-9a-f]{64}',manifest.get('sourceArchiveSha256','')): raise ValueError('Missing signed source digest')
    checks=manifest.get('checks',[])
    if len(checks)!=len(REQUIRED) or {check.get('workflow') for check in checks}!=REQUIRED: raise ValueError('Missing release gates')
    for check in checks:
        if type(check.get('runId')) is not int: raise ValueError('Invalid gate ID')
        run=lookup(check['runId'])
        if (run.get('head_sha')!=sha or run.get('head_branch')!='main' or run.get('event')!='push' or run.get('status')!='completed' or run.get('conclusion')!='success' or run.get('path')!='.github/workflows/'+check['workflow']): raise ValueError('Release gate has not passed for this main commit')
def main():
    tag,sha=sys.argv[1:]
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+',tag) or not re.fullmatch(r'[0-9a-f]{40}',sha): raise ValueError('Invalid release identity')
    base=f'https://github.com/{REPO}/releases/download/{tag}/'
    body=download(base+'security-gate.json')
    bundle=download(base+'security-gate.sigstore.json')
    verify_signature(body,bundle,tag,sha)
    manifest=json.loads(body)
    validate(manifest,tag,sha,lambda run_id:get(f'https://api.github.com/repos/{REPO}/actions/runs/{run_id}'))
    root=pathlib.Path(__file__).resolve().parents[2]
    if source_digest(root,sha)!=manifest['sourceArchiveSha256']: raise ValueError('Source archive does not match the signed release')
    print('Release signature, source digest and exact-commit CI verified: '+tag)
if __name__=='__main__':
    try: main()
    except Exception as error: raise SystemExit('Update blocked: '+str(error))
