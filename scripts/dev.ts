// `pnpm dev`: runs the API server (watch mode, SQLite, dev auth, seeded) and the Vite dev server together.
// Open http://127.0.0.1:5943 — Vite proxies /api to the server on :3000.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
// pnpm runs the server from apps/server, so resolve relative paths against the repo root, where the CLI's
// local mode looks: both then share data/dev.db and data/blobs.
const dbUrl = process.env.POIETIC_ISSUES_DATABASE_URL ?? 'sqlite:./data/dev.db';
const sqliteFile = /^sqlite:(?!:memory:)(.+)$/.exec(dbUrl)?.[1];
process.env.POIETIC_ISSUES_DATABASE_URL = sqliteFile
  ? `sqlite:${resolve(root, sqliteFile)}`
  : dbUrl;
process.env.POIETIC_ISSUES_BLOB_DIR = resolve(
  root,
  process.env.POIETIC_ISSUES_BLOB_DIR ?? 'data/blobs',
);

const procs = [
  { name: 'api', color: 36, cmd: 'pnpm', args: ['--filter', '@poietic-tech/issues-server', 'dev'] },
  { name: 'web', color: 35, cmd: 'pnpm', args: ['--filter', '@poietic-tech/issues-web', 'dev'] },
].map(({ name, color, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = `\x1b[${color}m${name.padEnd(3)}\x1b[0m │ `;
  const pipe = (stream: NodeJS.ReadableStream, out: NodeJS.WriteStream) =>
    stream.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n'))
        if (line.trim()) out.write(`${prefix}${line}\n`);
    });
  pipe(child.stdout!, process.stdout);
  pipe(child.stderr!, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with ${code}`);
    shutdown(code ?? 1);
  });
  return child;
});

function shutdown(code: number) {
  for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
