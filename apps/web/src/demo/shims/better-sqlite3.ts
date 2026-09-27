// A `better-sqlite3`-shaped database over sql.js (SQLite compiled to JavaScript), for the browser demo.
// It implements only what Kysely's SQLite driver and our dialect factory use.
import type { Database as SqlJsDatabase, SqlJsStatic, SqlValue } from 'sql.js';

let SQL: SqlJsStatic | undefined;
let initial: Uint8Array | undefined;

/** Must be called (with an initialised sql.js) before any database is opened. */
export function configureSqlJs(sqlJs: SqlJsStatic, data?: Uint8Array) {
  SQL = sqlJs;
  initial = data;
}

const opened: Database[] = [];
/** The most recently opened database (the demo opens exactly one). */
export function currentDatabase(): Database | undefined {
  return opened.at(-1);
}

type Param = SqlValue | boolean | undefined | bigint;

function bind(params: readonly Param[] = []): SqlValue[] {
  return params.map((p) =>
    p === undefined
      ? null
      : typeof p === 'boolean'
        ? p
          ? 1
          : 0
        : typeof p === 'bigint'
          ? Number(p)
          : p,
  );
}

class Statement {
  readonly reader: boolean;
  readonly #db: Database;
  readonly #sql: string;

  constructor(db: Database, sql: string) {
    this.#db = db;
    this.#sql = sql;
    const stmt = db.raw.prepare(sql);
    try {
      this.reader = stmt.getColumnNames().length > 0;
    } finally {
      stmt.free();
    }
  }

  all(params?: readonly Param[]): Record<string, unknown>[] {
    return [...this.iterate(params)];
  }

  *iterate(params?: readonly Param[]): Generator<Record<string, unknown>> {
    const stmt = this.#db.raw.prepare(this.#sql);
    try {
      stmt.bind(bind(params));
      while (stmt.step()) yield stmt.getAsObject() as Record<string, unknown>;
    } finally {
      stmt.free();
      this.#db.track(this.#sql);
    }
  }

  run(params?: readonly Param[]): { changes: number; lastInsertRowid: number } {
    this.#db.raw.run(this.#sql, bind(params));
    this.#db.track(this.#sql);
    const changes = this.#db.raw.getRowsModified();
    const id = this.#db.raw.exec('select last_insert_rowid()')[0]?.values[0]?.[0];
    return { changes, lastInsertRowid: Number(id ?? 0) };
  }
}

export default class Database {
  raw: SqlJsDatabase;
  /** True between BEGIN and COMMIT/ROLLBACK (the database must not be exported then). */
  inTransaction = false;
  readonly #pragmas: string[] = [];

  constructor(_filename: string) {
    if (!SQL) throw new Error('configureSqlJs() must run before opening a database');
    this.raw = new SQL.Database(initial);
    opened.push(this);
  }

  pragma(statement: string) {
    this.#pragmas.push(statement);
    if (/journal_mode|synchronous|busy_timeout/.test(statement)) return; // meaningless in memory
    this.raw.run(`pragma ${statement}`);
  }

  prepare(sql: string) {
    return new Statement(this, sql);
  }

  track(sql: string) {
    const head = sql.trimStart().slice(0, 12).toLowerCase();
    if (head.startsWith('begin')) this.inTransaction = true;
    else if (head.startsWith('commit') || head.startsWith('rollback') || head.startsWith('end'))
      this.inTransaction = false;
  }

  /** Serialises the database. sql.js reopens it afterwards, so connection pragmas are re-applied. */
  export(): Uint8Array {
    const data = this.raw.export();
    this.raw.run('pragma foreign_keys = ON');
    return data;
  }

  close() {
    this.raw.close();
  }
}
