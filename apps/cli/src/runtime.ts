import { type ApiClient, unwrap } from '@tracker/client';
import type { Command } from 'commander';
import { type GlobalFlags, resolveConfig, type ResolvedConfig } from './config.ts';
import { CliError, usage } from './errors.ts';
import type { CliIO } from './io.ts';
import { Output } from './output.ts';
import { openTransport, type Transport } from './transport.ts';

/** Per-invocation state shared by command handlers. */
export class Runtime {
  readonly io: CliIO;
  readonly config: ResolvedConfig;
  readonly out: Output;
  #transport: Transport | undefined;

  constructor(io: CliIO, flags: GlobalFlags) {
    this.io = io;
    this.config = resolveConfig(flags, io);
    this.out = new Output(io, this.config.format, this.config.fields);
  }

  /** The typed API client (opens the transport on first use). */
  async api(): Promise<ApiClient> {
    this.#transport ??= await openTransport(this.config, this.io);
    return this.#transport.client;
  }

  async describeTransport(): Promise<string> {
    await this.api();
    return this.#transport!.describe;
  }

  /** Awaits an openapi-fetch call and returns its data, throwing the API problem on failure. */
  async call<T>(request: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
    return unwrap(await request);
  }

  /** The project to act on: explicit flag > config; errors with guidance when missing. */
  project(explicit?: string): string {
    const project = explicit ?? this.config.project;
    if (!project)
      throw usage(
        'No project given: pass --project <KEY>, set TRACKER_PROJECT, or run `tracker init --project <KEY>`',
      );
    return project;
  }

  async close(): Promise<void> {
    await this.#transport?.close();
  }
}

type Handler = (rt: Runtime, args: unknown[], opts: Record<string, unknown>) => Promise<void>;

/** Global options every command inherits, plus the runtime lifecycle. */
export function makeAction(io: CliIO, handler: Handler) {
  return async (...all: unknown[]) => {
    const command = all.at(-1) as Command;
    const opts = command.optsWithGlobals() as Record<string, unknown>;
    const args = all.slice(0, -2);
    const rt = new Runtime(io, opts as GlobalFlags);
    try {
      await handler(rt, args, command.opts());
    } finally {
      await rt.close();
    }
  };
}

// ---- argument helpers ----

export const collect = (value: string, previous: string[] = []) => [
  ...previous,
  ...value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
];

export const collectRaw = (value: string, previous: string[] = []) => [...previous, value];

export function parseIntStrict(name: string) {
  return (value: string) => {
    const n = Number(value);
    if (!Number.isInteger(n)) throw usage(`${name} must be an integer`);
    return n;
  };
}

const PRIORITY_NAMES: Record<string, number> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 };

export function parsePriority(value: string): number {
  const n = PRIORITY_NAMES[value.toLowerCase()] ?? Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 4)
    throw usage('--priority must be 0-4 or none|urgent|high|medium|low');
  return n;
}

/** `none`/`null` → null (clear the field), otherwise the value. */
export function nullable(value: string): string | null {
  return value === 'none' || value === 'null' ? null : value;
}

/** Parses `value` as JSON when possible (numbers, booleans, arrays, null), else as a plain string. */
export function looseValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** `key=value` pairs (repeatable) → object; values parsed with {@link looseValue}. */
export function keyValues(
  pairs: string[] | undefined,
  stripPrefix?: string,
): Record<string, unknown> | undefined {
  if (!pairs?.length) return undefined;
  const out: Record<string, unknown> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx <= 0) throw usage(`Expected key=value, got "${pair}"`);
    let key = pair.slice(0, idx).trim();
    if (stripPrefix && key.startsWith(stripPrefix)) key = key.slice(stripPrefix.length);
    out[key] = looseValue(pair.slice(idx + 1));
  }
  return out;
}

/** Reads text from `-` (stdin) or a file path. */
export async function readTextArg(io: CliIO, value: string): Promise<string> {
  if (value === '-') return io.readStdin();
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  try {
    return await readFile(resolve(io.cwd, value), 'utf8');
  } catch (error) {
    throw usage(`Cannot read ${value}: ${(error as Error).message}`);
  }
}

/** Reads a JSON object from `-`, `@file` / a file path, or an inline JSON string. */
export async function readJsonArg(
  io: CliIO,
  value: string,
  what: string,
): Promise<Record<string, unknown>> {
  const text =
    value === '-' || value.startsWith('@') || !value.trim().startsWith('{')
      ? await readTextArg(io, value.replace(/^@/, ''))
      : value;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('expected a JSON object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw usage(`${what} is not valid JSON: ${(error as Error).message}`);
  }
}

export function assertNever(message: string): never {
  throw new CliError('INTERNAL', message);
}
