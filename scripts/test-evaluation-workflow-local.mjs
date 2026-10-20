import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { connect } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';

const exec = promisify(execFile);
const cwd = new URL('../', import.meta.url);
const image =
  'temporalio/temporal:latest@sha256:ad4c82c97bd12b417d1ea942610dbcd511afb250c4d5ed26c694009533df447e';
const name = `docoo-eval-temporal-${randomBytes(8).toString('hex')}`;
let containerId;
async function command(file, args, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Evaluation workflow gate failed.')),
    );
  });
}
try {
  await command('pnpm', ['--filter', '@docoo/api...', 'build']);
  const started = await exec('docker', [
    'run',
    '--detach',
    '--rm',
    '--pull=never',
    '--name',
    name,
    '--cpus',
    '2',
    '--memory',
    '1g',
    '--publish',
    '127.0.0.1::7233',
    image,
    'server',
    'start-dev',
    '--ip',
    '0.0.0.0',
  ]);
  containerId = started.stdout.trim();
  if (!/^[a-f0-9]{64}$/.test(containerId))
    throw new Error('Unexpected temporary container identifier.');
  const inspect = await exec('docker', [
    'inspect',
    containerId,
    '--format',
    '{{json (index .NetworkSettings.Ports "7233/tcp")}}',
  ]);
  const bindings = JSON.parse(inspect.stdout);
  if (
    !Array.isArray(bindings) ||
    bindings.length !== 1 ||
    bindings[0].HostIp !== '127.0.0.1' ||
    !/^\d{1,5}$/.test(bindings[0].HostPort)
  )
    throw new Error('Temporary Temporal must bind exactly one loopback-only port.');
  const port = Number(bindings[0].HostPort);
  let ready = false;
  for (let attempt = 0; attempt < 30 && !ready; attempt++) {
    ready = await new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.setTimeout(1000);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (!ready) await pause(1000);
  }
  if (!ready) throw new Error('Temporary Temporal did not become ready.');
  await command(
    'node',
    ['packages/database/test/paired-evaluation.integration.mjs', '--with-api', '--with-workflow'],
    { ...process.env, TEMPORAL_EVAL_ADDRESS: `127.0.0.1:${port}` },
  );
} finally {
  if (containerId && /^[a-f0-9]{64}$/.test(containerId)) {
    await exec('docker', ['stop', '--time', '5', containerId]);
    process.stdout.write('Removed only the temporary Temporal container created by this gate.\n');
  }
}
