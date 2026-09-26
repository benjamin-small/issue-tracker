import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { AwsClient } from 'aws4fetch';

/**
 * Where attachment bytes live. Metadata is in the `attachments` table; bytes are stored under random keys
 * (never user-supplied names). Implementations: local disk (development, single node) and S3-compatible
 * object storage (production: AWS S3, MinIO, R2, …).
 */
export interface BlobStore {
  readonly kind: 'local' | 's3';
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /**
   * A short-lived URL the client can download from directly (S3), carrying the given response headers.
   * Undefined when the server must stream the bytes itself (local disk).
   */
  presignedGetUrl?(
    key: string,
    opts: { contentType: string; disposition: string; expiresIn?: number },
  ): Promise<string>;
}

/** Generates a random, path-safe storage key. */
export function newBlobKey(): string {
  const id = randomUUID().replace(/-/g, '');
  return `att/${id.slice(0, 2)}/${id}`;
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export class LocalDiskBlobStore implements BlobStore {
  readonly kind = 'local' as const;
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  #path(key: string): string {
    const path = resolve(this.#root, key);
    if (!path.startsWith(this.#root + sep)) throw new Error('Invalid blob key');
    return path;
  }

  async put(key: string, data: Uint8Array, _contentType?: string): Promise<void> {
    const path = this.#path(key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, path);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.#path(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.#path(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return stat(this.#path(key)).then(
      () => true,
      () => false,
    );
  }
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style URLs (`endpoint/bucket/key`), needed for MinIO and most S3-compatible stores. Default true. */
  forcePathStyle?: boolean;
}

/** S3-compatible object storage using SigV4 (aws4fetch — no AWS SDK needed). */
export class S3BlobStore implements BlobStore {
  readonly kind = 's3' as const;
  readonly #client: AwsClient;
  readonly #config: S3Config;

  constructor(config: S3Config) {
    this.#config = config;
    this.#client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region ?? 'us-east-1',
      service: 's3',
    });
  }

  #url(key: string): string {
    const endpoint = this.#config.endpoint.replace(/\/+$/, '');
    const path = key.split('/').map(encodeURIComponent).join('/');
    if (this.#config.forcePathStyle ?? true) return `${endpoint}/${this.#config.bucket}/${path}`;
    const url = new URL(endpoint);
    return `${url.protocol}//${this.#config.bucket}.${url.host}/${path}`;
  }

  async #check(res: Response, action: string): Promise<Response> {
    if (!res.ok)
      throw new Error(`S3 ${action} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const res = await this.#client.fetch(this.#url(key), {
      method: 'PUT',
      body: data,
      headers: { 'content-type': contentType, 'content-length': String(data.byteLength) },
    });
    await this.#check(res, 'PUT');
  }

  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.#client.fetch(this.#url(key));
    if (res.status === 404) return null;
    await this.#check(res, 'GET');
    return new Uint8Array(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const res = await this.#client.fetch(this.#url(key), { method: 'DELETE' });
    if (res.status !== 404) await this.#check(res, 'DELETE');
  }

  async presignedGetUrl(
    key: string,
    opts: { contentType: string; disposition: string; expiresIn?: number },
  ): Promise<string> {
    const url = new URL(this.#url(key));
    url.searchParams.set('X-Amz-Expires', String(opts.expiresIn ?? 300));
    url.searchParams.set('response-content-type', opts.contentType);
    url.searchParams.set('response-content-disposition', opts.disposition);
    const signed = await this.#client.sign(url.toString(), {
      method: 'GET',
      aws: { signQuery: true },
    });
    return signed.url;
  }
}

/** Builds the configured blob store from environment-style settings. */
export function blobStoreFromEnv(
  env: Record<string, string | undefined>,
  defaultDir = './data/blobs',
): BlobStore {
  if ((env.TRACKER_BLOB_STORE ?? 'local') === 's3') {
    const need = (name: string) => {
      const value = env[name];
      if (!value) throw new Error(`${name} is required when TRACKER_BLOB_STORE=s3`);
      return value;
    };
    return new S3BlobStore({
      endpoint: need('TRACKER_S3_ENDPOINT'),
      bucket: need('TRACKER_S3_BUCKET'),
      region: env.TRACKER_S3_REGION ?? 'us-east-1',
      accessKeyId: need('TRACKER_S3_ACCESS_KEY_ID'),
      secretAccessKey: need('TRACKER_S3_SECRET_ACCESS_KEY'),
      forcePathStyle: env.TRACKER_S3_FORCE_PATH_STYLE !== 'false',
    });
  }
  return new LocalDiskBlobStore(env.TRACKER_BLOB_DIR ?? defaultDir);
}
