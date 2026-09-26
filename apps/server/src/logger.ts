import { Writable } from 'node:stream';
import { type Logger, pino, stdSerializers, stdTimeFunctions } from 'pino';

export type { Logger } from 'pino';

export interface LoggerOptions {
  level?: string;
  /** `json` (one object per line, for log collectors) or `pretty` (compact human-readable lines). */
  format?: 'json' | 'pretty';
}

const LEVELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};
const COLORS: Record<number, number> = { 10: 90, 20: 90, 30: 36, 40: 33, 50: 31, 60: 35 };
const OMIT = new Set(['level', 'time', 'msg', 'pid', 'hostname']);

/** A dependency-free pretty printer: `12:01:02 INFO  message key=value …`. */
function prettyStream(color: boolean): Writable {
  return new Writable({
    write(chunk: Buffer, _enc, done) {
      for (const line of chunk.toString().split('\n')) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as Record<string, unknown> & {
            level: number;
            time: number;
          };
          const time = new Date(entry.time).toISOString().slice(11, 19);
          const level = (LEVELS[entry.level] ?? String(entry.level)).padEnd(5);
          const extra = Object.entries(entry)
            .filter(([k]) => !OMIT.has(k))
            .map(([k, v]) =>
              k === 'err' && v && typeof v === 'object' && 'stack' in v
                ? `\n${String((v as { stack: string }).stack)}`
                : `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`,
            )
            .join(' ');
          const tag = color ? `\x1b[${COLORS[entry.level] ?? 0}m${level}\x1b[0m` : level;
          process.stdout.write(
            `${time} ${tag} ${String(entry.msg ?? '')}${extra ? ` ${extra}` : ''}\n`,
          );
        } catch {
          process.stdout.write(`${line}\n`);
        }
      }
      done();
    },
  });
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const base = {
    level: options.level ?? 'info',
    base: undefined,
    serializers: { err: stdSerializers.err },
    timestamp: stdTimeFunctions.epochTime,
  };
  return options.format === 'pretty'
    ? pino(base, prettyStream(Boolean(process.stdout.isTTY) && !process.env.NO_COLOR))
    : pino({ ...base, timestamp: stdTimeFunctions.isoTime });
}

/** A logger that discards everything (the default for embedded apps: tests, CLI local mode). */
export const silentLogger: Logger = pino({ level: 'silent' });
