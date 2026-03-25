import postgres from "postgres";

const FORBIDDEN_WORDS = [
  "insert",
  "update",
  "delete",
  "drop",
  "create",
  "alter",
  "truncate",
  "grant",
  "revoke",
  "execute",
  "copy",
  "call",
  "pg_sleep",
  "lo_import",
  "dblink",
] as const;

const DEFAULT_ROW_CAP = 100;

/**
 * Single-statement SELECT only; throws if validation fails.
 */
export function assertReadOnlySelect(sql: string): string {
  let s = sql.trim();
  if (!s) {
    throw new SqlGuardError("Empty SQL");
  }

  // strip one trailing semicolon
  s = s.replace(/;+\s*$/, "").trim();

  if (s.includes(";")) {
    throw new SqlGuardError("Only a single statement is allowed");
  }

  if (!/^select\b/i.test(s)) {
    throw new SqlGuardError("Only SELECT queries are allowed");
  }

  for (const word of FORBIDDEN_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(s)) {
      throw new SqlGuardError(`Forbidden keyword: ${word}`);
    }
  }

  if (/\binto\s+outfile\b/i.test(s)) {
    throw new SqlGuardError("INTO OUTFILE is not allowed");
  }

  // Strip trailing comments (basic)
  let exec = s.replace(/--[^\n]*$/gm, "").trim();

  if (!/\blimit\b/i.test(exec)) {
    exec = `${exec} LIMIT ${DEFAULT_ROW_CAP}`;
  }

  return exec;
}

export class SqlGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqlGuardError";
  }
}

let client: ReturnType<typeof postgres> | null = null;

function getClient(): ReturnType<typeof postgres> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set (Supabase → Settings → Database → Connection string → URI)"
    );
  }
  if (!client) {
    client = postgres(url, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return client;
}

function serializeValue(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      out[k] = serializeValue(v);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  return value;
}

export async function executeReadOnlySelect(
  sql: string
): Promise<Record<string, unknown>[]> {
  const safe = assertReadOnlySelect(sql);
  const sqlConn = getClient();
  const rows = (await sqlConn.unsafe(safe)) as Record<string, unknown>[];
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = serializeValue(v);
    }
    return out;
  });
}
