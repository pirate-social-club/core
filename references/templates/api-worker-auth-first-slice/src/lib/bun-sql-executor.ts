import type { SqlParams, SqlExecutor, TransactionalSqlExecutor } from "./sql-auth-bootstrap-store";

type BunSqlLike = {
  unsafe<T>(sql: string, params?: Array<string | number | null>): Promise<T[]>;
  begin<T>(fn: (tx: BunSqlLike) => Promise<T>): Promise<T>;
};

function compileNamedParams(sql: string, params: SqlParams = {}): {
  text: string;
  values: Array<string | number | null>;
} {
  const values: Array<string | number | null> = [];
  const positions = new Map<string, number>();
  let text = "";

  for (let index = 0; index < sql.length; ) {
    const char = sql[index];
    const previous = index > 0 ? sql[index - 1] : "";

    if (char !== ":" || previous === ":") {
      text += char;
      index += 1;
      continue;
    }

    const next = sql[index + 1] ?? "";
    if (!/[a-zA-Z_]/.test(next)) {
      text += char;
      index += 1;
      continue;
    }

    let end = index + 2;
    while (end < sql.length && /[a-zA-Z0-9_]/.test(sql[end] ?? "")) {
      end += 1;
    }

    const name = sql.slice(index + 1, end);
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      throw new Error(`Missing SQL parameter: ${name}`);
    }

    let position = positions.get(name);
    if (position == null) {
      values.push(params[name] ?? null);
      position = values.length;
      positions.set(name, position);
    }

    text += `$${position}`;
    index = end;
  }

  return { text, values };
}

class BunSqlExecutor implements SqlExecutor {
  constructor(protected readonly sql: BunSqlLike) {}

  async get<T>(query: string, params?: SqlParams): Promise<T | null> {
    const rows = await this.all<T>(query, params);
    return rows[0] ?? null;
  }

  async all<T>(query: string, params?: SqlParams): Promise<T[]> {
    const compiled = compileNamedParams(query, params);
    return this.sql.unsafe<T>(compiled.text, compiled.values);
  }

  async run(query: string, params?: SqlParams): Promise<void> {
    const compiled = compileNamedParams(query, params);
    await this.sql.unsafe(compiled.text, compiled.values);
  }
}

export class BunTransactionalSqlExecutor extends BunSqlExecutor implements TransactionalSqlExecutor {
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => fn(new BunSqlExecutor(tx)));
  }
}

export function createBunTransactionalSqlExecutor(databaseUrl: string): TransactionalSqlExecutor {
  return new BunTransactionalSqlExecutor(new Bun.SQL(databaseUrl) as BunSqlLike);
}
