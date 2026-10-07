import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for provider secrets (AI-001): every secret version gets its own data
 * key (AES-256-GCM); the data key is wrapped with the master key from the secret manager.
 * The plaintext only exists in memory for the provider call.
 */
export interface EncryptedSecret {
  readonly ciphertext: string;
  readonly iv: string;
  readonly tag: string;
  readonly wrappedKey: string;
  readonly wrapIv: string;
  readonly wrapTag: string;
  readonly keyId: string;
  /** Short non-reversible fingerprint to tell versions apart; never the secret itself. */
  readonly fingerprint: string;
}

export class SecretKeyError extends Error {}

export interface MasterKey {
  readonly id: string;
  readonly key: Buffer;
  readonly previous?: ReadonlyMap<string, Buffer>;
}

export function masterKeyFromEnv(env: NodeJS.ProcessEnv = process.env): MasterKey | null {
  const raw = env['SECRET_MASTER_KEY'];
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32)
    throw new SecretKeyError('SECRET_MASTER_KEY must be 32 bytes, base64 encoded.');
  const previous = new Map<string, Buffer>();
  const history: unknown = JSON.parse(env['SECRET_PREVIOUS_MASTER_KEYS'] ?? '{}');
  if (
    !history ||
    typeof history !== 'object' ||
    Array.isArray(history) ||
    Object.keys(history).length > 5
  )
    throw new SecretKeyError('Invalid previous master key configuration.');
  for (const [id, value] of Object.entries(history)) {
    if (
      typeof value !== 'string' ||
      !/^[A-Za-z0-9_-]{1,100}$/u.test(id) ||
      Buffer.from(value, 'base64').length !== 32
    )
      throw new SecretKeyError('Invalid previous master key configuration.');
    previous.set(id, Buffer.from(value, 'base64'));
  }
  return {
    previous,
    id:
      env['SECRET_MASTER_KEY_ID'] ??
      `mk-${createHash('sha256').update(key).digest('hex').slice(0, 8)}`,
    key,
  };
}

const TAG_BYTES = 16;

function seal(
  key: Buffer,
  plaintext: Buffer,
  aad: string,
): { data: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    data: data.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function open(key: Buffer, sealed: { data: string; iv: string; tag: string }, aad: string): Buffer {
  // A pinned tag length rejects truncated tags, which would weaken authentication.
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]);
}

/** `context` binds the ciphertext to its connection and version (AAD), so rows cannot be swapped. */
export function encryptSecret(secret: string, master: MasterKey, context: string): EncryptedSecret {
  const dataKey = randomBytes(32);
  const body = seal(dataKey, Buffer.from(secret, 'utf8'), context);
  const wrapped = seal(master.key, dataKey, `${context}|key`);
  dataKey.fill(0);
  return {
    ciphertext: body.data,
    iv: body.iv,
    tag: body.tag,
    wrappedKey: wrapped.data,
    wrapIv: wrapped.iv,
    wrapTag: wrapped.tag,
    keyId: master.id,
    fingerprint: createHash('sha256').update(`docoo-secret|${secret}`).digest('hex').slice(0, 12),
  };
}

export function decryptSecret(
  encrypted: EncryptedSecret,
  master: MasterKey,
  context: string,
): string {
  const wrappingKey =
    encrypted.keyId === master.id ? master.key : master.previous?.get(encrypted.keyId);
  if (!wrappingKey)
    throw new SecretKeyError('The secret was sealed with an unavailable master key.');
  const dataKey = open(
    wrappingKey,
    { data: encrypted.wrappedKey, iv: encrypted.wrapIv, tag: encrypted.wrapTag },
    `${context}|key`,
  );
  try {
    return open(
      dataKey,
      { data: encrypted.ciphertext, iv: encrypted.iv, tag: encrypted.tag },
      context,
    ).toString('utf8');
  } finally {
    dataKey.fill(0);
  }
}

/** Removes anything that looks like a credential from text that may be logged or shown. */
export function sanitizeError(message: string, secrets: readonly string[] = []): string {
  let text = message;
  for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED]');
  return text
    .replace(/(sk|key|AIza|xai|ant)[-_A-Za-z0-9]{12,}/gu, '[REDACTED]')
    .replace(/(bearer\s+)[^\s"']+/giu, '$1[REDACTED]')
    .slice(0, 300);
}

/** Change only the envelope wrapping: plaintext provider credentials never leave the cipher. */
export function rewrapSecret(
  encrypted: EncryptedSecret,
  master: MasterKey,
  context: string,
): EncryptedSecret {
  const oldKey = encrypted.keyId === master.id ? master.key : master.previous?.get(encrypted.keyId);
  if (!oldKey) throw new SecretKeyError('The previous master key is unavailable.');
  const dataKey = open(
    oldKey,
    { data: encrypted.wrappedKey, iv: encrypted.wrapIv, tag: encrypted.wrapTag },
    `${context}|key`,
  );
  try {
    const wrapped = seal(master.key, dataKey, `${context}|key`);
    return {
      ...encrypted,
      wrappedKey: wrapped.data,
      wrapIv: wrapped.iv,
      wrapTag: wrapped.tag,
      keyId: master.id,
    };
  } finally {
    dataKey.fill(0);
  }
}
