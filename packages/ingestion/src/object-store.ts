import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface ObjectHead {
  readonly size: number;
  readonly contentType: string | null;
}

/** Object storage port; the S3 implementation works with AWS S3, SeaweedFS and MinIO. */
export interface ObjectStore {
  presignPut(
    key: string,
    contentType: string,
    contentLength: number,
    expiresInSeconds: number,
  ): Promise<string>;
  head(key: string): Promise<ObjectHead | null>;
  get(key: string, maxBytes: number): Promise<Uint8Array>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class ObjectTooLargeError extends Error {
  constructor() {
    super('object_too_large');
  }
}

export interface S3Config {
  readonly endpoint?: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
  /** Endpoint browsers use for presigned uploads, when it differs from the internal one. */
  readonly publicEndpoint?: string;
}

export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  const bucket = env['S3_BUCKET'];
  const accessKeyId = env['S3_ACCESS_KEY_ID'];
  const secretAccessKey = env['S3_SECRET_ACCESS_KEY'];
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    ...(env['S3_ENDPOINT'] ? { endpoint: env['S3_ENDPOINT'] } : {}),
    ...(env['S3_PUBLIC_ENDPOINT'] ? { publicEndpoint: env['S3_PUBLIC_ENDPOINT'] } : {}),
    region: env['S3_REGION'] ?? 'us-east-1',
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: env['S3_FORCE_PATH_STYLE'] === 'true',
  };
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly signer: S3Client;

  constructor(private readonly config: S3Config) {
    const base = {
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.client = new S3Client({
      ...base,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
    const signerEndpoint = config.publicEndpoint ?? config.endpoint;
    this.signer = new S3Client({
      ...base,
      ...(signerEndpoint ? { endpoint: signerEndpoint } : {}),
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
    }
  }

  presignPut(
    key: string,
    contentType: string,
    contentLength: number,
    expiresInSeconds: number,
  ): Promise<string> {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      { expiresIn: expiresInSeconds, signableHeaders: new Set(['content-type', 'content-length']) },
    );
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  async get(key: string, maxBytes: number): Promise<Uint8Array> {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if ((object.ContentLength ?? 0) > maxBytes) throw new ObjectTooLargeError();
    const bytes = await object.Body!.transformToByteArray();
    if (bytes.length > maxBytes) throw new ObjectTooLargeError();
    return bytes;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async copy(from: string, to: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        Key: to,
        CopySource: `${this.config.bucket}/${from.split('/').map(encodeURIComponent).join('/')}`,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}

/** Object keys: quarantine first, accepted copies only after scan and MIME checks. */
export const objectKeys = {
  quarantine: (workspaceId: string, assetId: string, versionId: string): string =>
    `quarantine/${workspaceId}/${assetId}/${versionId}`,
  accepted: (workspaceId: string, assetId: string, versionId: string): string =>
    `sources/${workspaceId}/${assetId}/${versionId}`,
};

/** In-memory store for tests. */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  presignPut(key: string): Promise<string> {
    return Promise.resolve(`memory://upload/${key}`);
  }

  head(key: string): Promise<ObjectHead | null> {
    const object = this.objects.get(key);
    return Promise.resolve(
      object ? { size: object.bytes.length, contentType: object.contentType } : null,
    );
  }

  get(key: string, maxBytes: number): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (!object) return Promise.reject(new Error('not found'));
    if (object.bytes.length > maxBytes) return Promise.reject(new ObjectTooLargeError());
    return Promise.resolve(object.bytes);
  }

  put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { bytes, contentType });
    return Promise.resolve();
  }

  copy(from: string, to: string): Promise<void> {
    const object = this.objects.get(from);
    if (!object) return Promise.reject(new Error('not found'));
    this.objects.set(to, object);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}
