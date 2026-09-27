// A silent logger for the browser demo (the real server logs with pino).
type Log = (...args: unknown[]) => void;
const noop: Log = () => {};

export interface Logger {
  level: string;
  trace: Log;
  debug: Log;
  info: Log;
  warn: Log;
  error: Log;
  fatal: Log;
  child(bindings?: object): Logger;
}

const logger: Logger = {
  level: 'silent',
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: (...args: unknown[]) => console.error(...args),
  fatal: noop,
  child: () => logger,
};

export function pino(..._args: unknown[]): Logger {
  return logger;
}
export const stdSerializers = { err: (e: unknown) => e };
export const stdTimeFunctions = { epochTime: () => '', isoTime: () => '' };
export default pino;
