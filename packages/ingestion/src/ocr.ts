import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface OcrResult {
  readonly text: string;
  /** Mean word confidence between 0 and 1. */
  readonly confidence: number;
}

/** OCR port (ING-004). */
export interface OcrEngine {
  readonly id: string;
  recognizeImage(image: Uint8Array, languages: readonly string[]): Promise<OcrResult>;
  /** Renders and recognises the given 1-based PDF pages. */
  recognizePdfPages(
    pdf: Uint8Array,
    pages: readonly number[],
    languages: readonly string[],
  ): Promise<Map<number, OcrResult>>;
}

function run(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', OMP_THREAD_LIMIT: '1' },
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

/** Mean confidence of recognised words in Tesseract TSV output. */
export function tsvConfidence(tsv: string): number {
  const values: number[] = [];
  for (const line of tsv.split('\n').slice(1)) {
    const columns = line.split('\t');
    const confidence = Number(columns[10]);
    if (columns.length >= 12 && columns[11]?.trim() && confidence >= 0) values.push(confidence);
  }
  return values.length === 0
    ? 0
    : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 1000;
}

/**
 * Local Tesseract 5 with the `fas` and `eng` models; scanned PDF pages are rasterised with
 * poppler `pdftoppm` at 300 dpi. Both run as separate processes with a minimal environment.
 */
export class TesseractOcr implements OcrEngine {
  readonly id = 'tesseract-5';

  constructor(private readonly timeoutMs = 120_000) {}

  async recognizeImage(image: Uint8Array, languages: readonly string[]): Promise<OcrResult> {
    const directory = await mkdtemp(join(tmpdir(), 'docoo-ocr-'));
    try {
      const input = join(directory, 'image');
      await writeFile(input, image, { mode: 0o600 });
      return await this.recognizeFile(input, directory, languages);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async recognizePdfPages(
    pdf: Uint8Array,
    pages: readonly number[],
    languages: readonly string[],
  ): Promise<Map<number, OcrResult>> {
    const directory = await mkdtemp(join(tmpdir(), 'docoo-ocr-'));
    const results = new Map<number, OcrResult>();
    try {
      const input = join(directory, 'input.pdf');
      await writeFile(input, pdf, { mode: 0o600 });
      for (const page of pages) {
        const prefix = join(directory, `page-${page}`);
        await run(
          'pdftoppm',
          ['-r', '300', '-gray', '-png', '-f', String(page), '-l', String(page), input, prefix],
          this.timeoutMs,
        );
        const image = (await readdir(directory)).find(
          (name) => name.startsWith(`page-${page}`) && name.endsWith('.png'),
        );
        if (!image) continue;
        results.set(page, await this.recognizeFile(join(directory, image), directory, languages));
      }
      return results;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async recognizeFile(
    input: string,
    directory: string,
    languages: readonly string[],
  ): Promise<OcrResult> {
    const base = join(directory, `ocr-${Math.random().toString(36).slice(2)}`);
    await run(
      'tesseract',
      [
        input,
        base,
        '-l',
        languages.join('+'),
        '--psm',
        '3',
        '-c',
        'preserve_interword_spaces=1',
        'txt',
        'tsv',
      ],
      this.timeoutMs,
    );
    const [text, tsv] = await Promise.all([
      readFile(`${base}.txt`, 'utf8'),
      readFile(`${base}.tsv`, 'utf8'),
    ]);
    return { text: text.trim(), confidence: tsvConfidence(tsv) };
  }
}

/** OCR language models for a document language; English is always included. */
export function ocrLanguages(language: string | null | undefined): string[] {
  return language === 'fa' ? ['fas', 'eng'] : ['eng'];
}
