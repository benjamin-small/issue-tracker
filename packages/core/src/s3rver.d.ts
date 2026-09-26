// Minimal typings for the S3 emulator used by the blob store tests (the package ships none).
declare module 's3rver' {
  interface S3rverOptions {
    port?: number;
    address?: string;
    silent?: boolean;
    directory?: string;
    configureBuckets?: Array<{ name: string; configs: unknown[] }>;
  }
  export default class S3rver {
    constructor(options: S3rverOptions);
    run(): Promise<unknown>;
    close(): Promise<void>;
  }
}
