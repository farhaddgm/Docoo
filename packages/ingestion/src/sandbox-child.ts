/**
 * Parser sandbox entry (ING-003). Runs in a separate Node process started with the
 * permission model (no child processes, workers, addons or writes; reads only the input
 * directory and the parser code), an empty environment and a memory cap. Node 24 has no
 * network permission, so every network entry point is disabled here before parsing starts.
 */
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { readFileSync, writeFileSync } from 'node:fs';

function denied(): never {
  throw new Error('Network access is disabled in the parser sandbox.');
}

net.Socket.prototype.connect = denied;
net.connect = denied;
net.createConnection = denied;
tls.connect = denied;
dns.lookup = Object.assign(denied, { __promisify__: denied });
dns.resolve = Object.assign(denied, { __promisify__: denied });
dns.promises.lookup = denied;
dgram.createSocket = denied;
http.request = denied;
http.get = denied;
https.request = denied;
https.get = denied;
Object.defineProperty(globalThis, 'fetch', { value: denied, writable: false });
Object.defineProperty(globalThis, 'WebSocket', { value: undefined, writable: false });

const [, , inputPath, mime] = process.argv;

/** Self-test of the restrictions, used by the test suite as evidence (NFR-SEC-006). */
export const PROBE_MIME = 'application/x-docoo-sandbox-probe';

async function probe(): Promise<Record<string, boolean>> {
  const blocked = async (attempt: () => unknown): Promise<boolean> => {
    try {
      await attempt();
      return false;
    } catch {
      return true;
    }
  };
  const childProcess = await import('node:child_process');
  return {
    // nosemgrep -- deliberate: the probe proves outbound HTTP is blocked in the sandbox
    fetch: await blocked(() => fetch('http://example.com/')),
    socket: await blocked(() => net.connect(80, 'example.com')),
    dns: await blocked(() => dns.promises.lookup('example.com')),
    readOutsideInput: await blocked(() => readFileSync('/etc/hostname')),
    write: await blocked(() => writeFileSync(`${inputPath!}.out`, 'x')),
    childProcess: await blocked(() => childProcess.execFileSync('true')),
    environmentEmpty: Object.keys(process.env).every((key) => key === 'NODE_ENV'),
  };
}

async function main(): Promise<void> {
  if (mime === PROBE_MIME) {
    process.stdout.write(JSON.stringify({ ok: true, probe: await probe() }));
    return;
  }
  const { extractStructured } = await import('./extract.js');
  const bytes = new Uint8Array(readFileSync(inputPath!));
  const extraction = await extractStructured(bytes, mime!);
  process.stdout.write(JSON.stringify({ ok: true, extraction }));
}

main().catch((error: unknown) => {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'parse_failed';
  process.stdout.write(JSON.stringify({ ok: false, code }));
  process.exitCode = 0;
});
