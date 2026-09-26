# 0012. Attachment bytes live in a pluggable blob store, never the database

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Attachments must work with zero setup in development (SQLite, one machine) and scale in production (Postgres, several replicas). Storing bytes in the database bloats backups and couples file size limits to the database. Uploaded files are also untrusted content served from the app's own origin.

## Decision

- A small `BlobStore` interface (`put`, `get`, `delete`, optional `presignedGetUrl`) lives in `packages/core`. There are two implementations: `LocalDiskBlobStore` (the default, under `TRACKER_BLOB_DIR`) and `S3BlobStore` for any S3-compatible service.
- `S3BlobStore` signs requests with `aws4fetch` (a tiny SigV4 signer on top of `fetch`) rather than the AWS SDK. Downloads redirect to presigned URLs, so bytes don't pass through the API server.
- Storage keys are random. The database stores metadata only: filename, detected content type, size and sha256.
- Bytes are written before the write transaction and deleted if it fails. Blob deletes after a soft-delete are best effort. An orphaned blob is harmless; a row without bytes is not.
- The server sniffs the media type from the bytes. Only raster images are served inline, and every download carries `nosniff` and a sandboxing CSP.
- Tests run the S3 contract against the `s3rver` emulator locally, and against real MinIO in CI (`TEST_S3_ENDPOINT`).

## Consequences

- Backups need both the database and the blob store.
- Multi-replica deployments must use S3 (or shared disk).
- New backends (GCS, Azure) only need to implement the interface.
