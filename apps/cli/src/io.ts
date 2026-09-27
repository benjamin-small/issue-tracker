/** Everything the CLI touches in the outside world, injectable for tests. */
export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Writes raw bytes to stdout (binary downloads); text-only IO falls back to UTF-8 decoding. */
  stdoutBytes?: (bytes: Uint8Array) => void;
  env: Record<string, string | undefined>;
  cwd: string;
  /** Reads all of stdin (for `--body-file -`, `--input -`). */
  readStdin: () => Promise<string>;
  /** Whether stdout is an interactive terminal (enables colour and human niceties). */
  isTTY: boolean;
  /** Overrides the transport (tests): every API call goes through this fetch. */
  fetch?: (request: Request) => Promise<Response>;
}

export async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks).toString('utf8');
}

export function processIO(): CliIO {
  return {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    stdoutBytes: (b) => process.stdout.write(b),
    env: process.env,
    cwd: process.cwd(),
    readStdin: () => readAll(process.stdin),
    isTTY: Boolean(process.stdout.isTTY),
  };
}
