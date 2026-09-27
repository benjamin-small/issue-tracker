// Serves build-demo/ as plain static files under /some/path/ (like an artifact or static host would) — no API.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../build-demo/', import.meta.url));
const PREFIX = '/some/path/';
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (!url.pathname.startsWith(PREFIX)) return res.writeHead(404).end();
  const rel = normalize(url.pathname.slice(PREFIX.length) || 'index.html');
  if (rel.startsWith('..')) return res.writeHead(400).end();
  try {
    const body = await readFile(join(root, rel));
    res
      .writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(Number(process.env.DEMO_PORT ?? 3200), '127.0.0.1');
