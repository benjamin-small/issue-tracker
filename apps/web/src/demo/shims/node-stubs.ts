// Browser stand-ins for Node modules the server code imports but the in-browser demo never calls
// (file storage, outgoing HTTP, process management). Calling any of them throws a clear error.
const unavailable =
  (name: string) =>
  (..._args: unknown[]): never => {
    throw new Error(`${name} is not available in the browser demo`);
  };

// node:fs, node:fs/promises
export const readFileSync = unavailable('fs.readFileSync');
export const writeFileSync = unavailable('fs.writeFileSync');
export const mkdirSync = unavailable('fs.mkdirSync');
export const mkdtempSync = unavailable('fs.mkdtempSync');
export const rmSync = unavailable('fs.rmSync');
export const existsSync = () => false;
export const mkdir = unavailable('fs.mkdir');
export const readFile = unavailable('fs.readFile');
export const writeFile = unavailable('fs.writeFile');
export const rename = unavailable('fs.rename');
export const rm = unavailable('fs.rm');
export const stat = unavailable('fs.stat');

// node:path (enough for the imports that run at module load)
export const sep = '/';
export const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/');
export const dirname = (p: string) => p.replace(/\/[^/]*$/, '') || '/';
export const resolve = (...parts: string[]) => join(...parts);

// node:os, node:url, node:util
export const tmpdir = () => '/tmp';
export const hostname = () => 'browser';
export const fileURLToPath = (url: string | URL) => new URL(url).pathname;
export const promisify = unavailable('util.promisify');

// node:http, node:https, node:dns, node:net
export const createServer = unavailable('http.createServer');
export const request = unavailable('http.request');
export const lookup = unavailable('dns.lookup');
export const isIP = (value: string) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(value) ? 4 : value.includes(':') ? 6 : 0;
export class BlockList {
  addSubnet() {}
  check() {
    return true;
  }
}

// node:stream
export class Writable {
  constructor(_options?: unknown) {}
}

// @hono/node-server
export const serve = unavailable('serve');
export const serveStatic = () => unavailable('serveStatic');

// pg
export class Pool {
  constructor() {
    throw new Error('Postgres is not available in the browser demo');
  }
}
export class Client extends Pool {}
export const types = { getTypeParser: () => (v: unknown) => v, setTypeParser() {} };

export default {
  request,
  createServer,
  lookup,
  Pool,
  Client,
  types,
};
