import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ExtractionError, type Extraction } from './extract.js';

export interface SandboxOptions {
  readonly timeoutMs?: number;
  readonly memoryMb?: number;
  readonly maxOutputBytes?: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Directories the parser process may read: its own code and its dependencies only. */
function codeRoots(): string[] {
  const roots = new Set<string>([realpathSync(join(here, '..'))]);
  for (const dependency of [
    'fflate',
    'fast-xml-parser',
    'pdfjs-dist/legacy/build/pdf.mjs',
    '@docoo/knowledge',
  ]) {
    const resolved = realpathSync(require.resolve(dependency));
    const store = resolved.indexOf(`${sep}.pnpm${sep}`);
    if (store >= 0) {
      roots.add(resolved.slice(0, store + `${sep}.pnpm`.length));
    } else {
      const modules = resolved.lastIndexOf(`${sep}node_modules${sep}`);
      roots.add(
        modules >= 0
          ? resolved.slice(0, modules + `${sep}node_modules`.length)
          : dirname(dirname(resolved)),
      );
    }
  }
  return [...roots];
}

/**
 * Parses a file in a separate, permission-restricted Node process (ING-003, NFR-SEC-006).
 * The parent only passes the file through a private temporary directory and reads JSON back.
 */
export async function extractInSandbox(
  bytes: Uint8Array,
  mime: string,
  options: SandboxOptions = {},
): Promise<Extraction> {
  const result = (await runSandbox(bytes, mime, options)) as { extraction: Extraction };
  return result.extraction;
}

/** Runs the sandbox restriction self-test and returns which operations were blocked. */
export async function probeSandbox(): Promise<Record<string, boolean>> {
  const result = (await runSandbox(
    new Uint8Array([0]),
    'application/x-docoo-sandbox-probe',
    {},
  )) as {
    probe: Record<string, boolean>;
  };
  return result.probe;
}

async function runSandbox(
  bytes: Uint8Array,
  mime: string,
  options: SandboxOptions,
): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), 'docoo-parse-'));
  const input = join(directory, 'input');
  await writeFile(input, bytes, { mode: 0o600 });
  // Under the test runner this module is TypeScript in src/; the child always runs built code.
  const childEntry = here.endsWith(`${sep}src`)
    ? join(here, '..', 'dist', 'sandbox-child.js')
    : join(here, 'sandbox-child.js');
  const args = [
    '--permission',
    `--allow-fs-read=${realpathSync(directory)}`,
    ...codeRoots().map((root) => `--allow-fs-read=${root}`),
    '--disallow-code-generation-from-strings',
    `--max-old-space-size=${options.memoryMb ?? 768}`,
    childEntry,
    realpathSync(input),
    mime,
  ];
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        env: { NODE_ENV: 'production' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const chunks: Buffer[] = [];
      let size = 0;
      const limit = options.maxOutputBytes ?? 200 * 1024 * 1024;
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new ExtractionError('parser_timeout'));
      }, options.timeoutMs ?? 120_000);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          child.kill('SIGKILL');
          reject(new ExtractionError('parser_output_too_large'));
        } else {
          chunks.push(chunk);
        }
      });
      child.stderr.resume();
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
        else reject(new ExtractionError(signal ? 'parser_killed' : 'parser_crashed'));
      });
    });
    const result = JSON.parse(output) as { ok: true } | { ok: false; code: string };
    if (!result.ok) throw new ExtractionError(result.code);
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
