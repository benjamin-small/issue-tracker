import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDialect } from '@tracker/db/testing';
import S3rver from 's3rver';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type BlobStore,
  contentDisposition,
  createIssue,
  createProject,
  deleteAttachment,
  getAttachment,
  listAttachments,
  LocalDiskBlobStore,
  S3BlobStore,
  sanitizeFilename,
  sniffContentType,
  uploadAttachment,
} from './index.ts';
import { createTestContext, type TestContext } from './testing.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const text = (s: string) => new TextEncoder().encode(s);
const dir = mkdtempSync(join(tmpdir(), 'tracker-blobs-'));

describe('content type detection', () => {
  it('trusts bytes, not names', () => {
    expect(sniffContentType(PNG, 'x.txt')).toBe('image/png');
    expect(sniffContentType(text('<svg onload="alert(1)"></svg>'), 'evil.svg')).toBe('text/plain');
    expect(sniffContentType(text('<html><script>x</script>'), 'page.html')).toBe('text/plain');
    expect(sniffContentType(text('%PDF-1.7 ...'), 'doc.pdf')).toBe('application/pdf');
    expect(sniffContentType(text('{"a":1}'), 'data.json')).toBe('application/json');
    expect(sniffContentType(new Uint8Array([0, 1, 2, 3]), 'x.bin')).toBe(
      'application/octet-stream',
    );
  });

  it('sanitizes filenames and encodes dispositions', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\a\\report "final".pdf')).toBe('report final.pdf');
    expect(sanitizeFilename('\u0000\u0007')).toBe('file');
    expect(contentDisposition('attachment', 'résumé "v2".pdf')).toBe(
      `attachment; filename="r_sum_ _v2_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22v2%22.pdf`,
    );
  });
});

async function blobContract(store: BlobStore) {
  const key = 'att/ab/contract-test';
  await store.put(key, PNG, 'image/png');
  expect(await store.get(key)).toEqual(PNG);
  await store.delete(key);
  expect(await store.get(key)).toBeNull();
  await store.delete(key); // idempotent
}

describe('blob stores', () => {
  it('local disk: put/get/delete, and rejects path traversal', async () => {
    const store = new LocalDiskBlobStore(join(dir, 'local'));
    await blobContract(store);
    await expect(store.put('../outside', PNG, 'image/png')).rejects.toThrow(/Invalid blob key/);
  });

  describe('S3', () => {
    let server: S3rver | undefined;
    let store: S3BlobStore;
    beforeAll(async () => {
      // Real S3-compatible storage when configured (CI runs SeaweedFS); otherwise an in-process emulator.
      if (process.env.TEST_S3_ENDPOINT) {
        store = new S3BlobStore({
          endpoint: process.env.TEST_S3_ENDPOINT,
          bucket: process.env.TEST_S3_BUCKET ?? 'tracker',
          accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? 'tracker',
          secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'tracker-secret',
        });
        return;
      }
      server = new S3rver({
        port: 0,
        address: '127.0.0.1',
        silent: true,
        directory: join(dir, 's3'),
        configureBuckets: [{ name: 'tracker', configs: [] }],
      });
      const { port } = (await server.run()) as unknown as { port: number };
      store = new S3BlobStore({
        endpoint: `http://127.0.0.1:${port}`,
        bucket: 'tracker',
        accessKeyId: 'S3RVER',
        secretAccessKey: 'S3RVER',
      });
    });
    afterAll(async () => {
      await server?.close();
    });

    it('put/get/delete', async () => {
      await blobContract(store);
    });

    it('presigns downloads with response headers', async () => {
      await store.put('att/cd/presigned', PNG, 'image/png');
      const url = await store.presignedGetUrl!('att/cd/presigned', {
        contentType: 'image/png',
        disposition: contentDisposition('inline', 'shot.png'),
      });
      expect(url).toContain('X-Amz-Signature=');
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
      expect(res.headers.get('content-disposition')).toContain('inline');
    });

    it('can stream instead of presigning, or presign for a public endpoint', async () => {
      const base = {
        endpoint: 'http://minio:9000',
        bucket: 'b',
        accessKeyId: 'k',
        secretAccessKey: 's',
      };
      expect(new S3BlobStore({ ...base, presign: false }).presignedGetUrl).toBeUndefined();
      const url = await new S3BlobStore({
        ...base,
        publicEndpoint: 'https://files.example.com',
      }).presignedGetUrl!('att/x', { contentType: 'image/png', disposition: 'inline' });
      expect(url).toMatch(/^https:\/\/files\.example\.com\/b\/att\/x\?/);
    });
  });
});

describe(`attachments service (${testDialect()})`, () => {
  let t: TestContext;
  const blobs = new LocalDiskBlobStore(join(dir, 'svc'));
  beforeAll(async () => {
    t = await createTestContext();
    await createProject(t.ctx, { key: 'ATT', name: 'Attachments' });
  });
  afterAll(async () => {
    await t.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it('uploads, lists, and deletes with history', async () => {
    const issue = await createIssue(t.member, 'ATT', { title: 'With files' });
    const att = await uploadAttachment(t.member, blobs, issue.key, {
      filename: '../shot.png',
      data: PNG,
    });
    expect(att).toMatchObject({
      filename: 'shot.png',
      contentType: 'image/png',
      size: PNG.byteLength,
      url: `/api/v1/attachments/${att.id}/content`,
    });
    expect(att).not.toHaveProperty('storageKey');
    expect((await listAttachments(t.ctx, issue.key)).map((a) => a.id)).toEqual([att.id]);
    const stored = await getAttachment(t.ctx, att.id);
    expect(await blobs.get(stored.storageKey)).toEqual(PNG);

    await expect(deleteAttachment(t.agent, blobs, att.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await deleteAttachment(t.member, blobs, att.id);
    expect(await listAttachments(t.ctx, issue.key)).toEqual([]);
    expect(await blobs.get(stored.storageKey)).toBeNull();
    await expect(getAttachment(t.ctx, att.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('enforces size limits and cleans up blobs when the write fails', async () => {
    const issue = await createIssue(t.ctx, 'ATT', { title: 'Limits' });
    await expect(
      uploadAttachment(t.ctx, blobs, issue.key, { filename: 'x', data: new Uint8Array() }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      uploadAttachment(
        t.ctx,
        blobs,
        issue.key,
        { filename: 'big.bin', data: new Uint8Array(2048) },
        { maxBytes: 1024 },
      ),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    const puts: string[] = [];
    const spy: BlobStore = {
      ...blobs,
      kind: 'local',
      put: async (k, d, c) => (puts.push(k), blobs.put(k, d, c)),
      get: (k) => blobs.get(k),
      delete: (k) => blobs.delete(k),
    };
    await expect(
      uploadAttachment(t.ctx, spy, issue.key, {
        filename: 'a.txt',
        data: text('hi'),
        commentId: 'cmt_nope',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(puts).toHaveLength(1);
    expect(await blobs.get(puts[0]!)).toBeNull();
  });
});
