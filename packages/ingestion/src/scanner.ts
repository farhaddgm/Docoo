import { connect } from 'node:net';

export interface ScanResult {
  readonly status: 'clean' | 'infected' | 'error';
  readonly engine: string;
  readonly signature: string | null;
  readonly detail: string | null;
}

/** Malware scanner port (ING-002). Anything other than `clean` keeps the file quarantined. */
export interface MalwareScanner {
  scan(bytes: Uint8Array): Promise<ScanResult>;
}

/**
 * ClamAV `clamd` over TCP with the INSTREAM command. Fails closed: a connection problem,
 * timeout or unexpected reply is `error`, never `clean`.
 */
export class ClamdScanner implements MalwareScanner {
  constructor(
    private readonly host: string,
    private readonly port = 3310,
    private readonly timeoutMs = 60_000,
  ) {}

  scan(bytes: Uint8Array): Promise<ScanResult> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let settled = false;
      const finish = (result: ScanResult): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };
      const socket = connect({ host: this.host, port: this.port });
      socket.setTimeout(this.timeoutMs, () =>
        finish({ status: 'error', engine: 'clamd', signature: null, detail: 'timeout' }),
      );
      socket.on('error', (error) =>
        finish({ status: 'error', engine: 'clamd', signature: null, detail: error.message }),
      );
      socket.on('data', (data: Buffer) => chunks.push(data));
      socket.on('end', () => finish(parseClamdReply(Buffer.concat(chunks).toString('utf8'))));
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const chunkSize = 64 * 1024;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          const chunk = bytes.subarray(offset, offset + chunkSize);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length, 0);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
    });
  }
}

export function parseClamdReply(reply: string): ScanResult {
  const text = reply.replace(/\0/gu, '').trim();
  if (/^stream: OK$/u.test(text)) {
    return { status: 'clean', engine: 'clamd', signature: null, detail: null };
  }
  const found = /^stream: (.+) FOUND$/u.exec(text);
  if (found) return { status: 'infected', engine: 'clamd', signature: found[1]!, detail: null };
  return {
    status: 'error',
    engine: 'clamd',
    signature: null,
    detail: text.slice(0, 200) || 'empty reply',
  };
}

/** Used when no scanner is configured: every file stays quarantined. */
export class UnavailableScanner implements MalwareScanner {
  scan(): Promise<ScanResult> {
    return Promise.resolve({
      status: 'error',
      engine: 'none',
      signature: null,
      detail: 'No malware scanner is configured (CLAMD_HOST).',
    });
  }
}

export function scannerFromEnv(env: NodeJS.ProcessEnv = process.env): MalwareScanner {
  const host = env['CLAMD_HOST'];
  if (!host) return new UnavailableScanner();
  return new ClamdScanner(host, Number(env['CLAMD_PORT'] ?? 3310));
}
