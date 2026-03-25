import { NextResponse } from "next/server";
import { generateSqlFromQuestion } from "@/lib/llm/nl-to-sql";
import { executeReadOnlySelect, SqlGuardError } from "@/lib/sql/readonly";
import { extractEntitiesFromRows } from "@/lib/graph/extractEntities";

export const runtime = "nodejs";

type QueryBody = {
  query?: unknown;
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON body",
        sql: null,
        data: [],
        explanation: "",
        entities: [],
      },
      { status: 400 }
    );
  }

  const b = body as QueryBody;
  const userQuery = typeof b.query === "string" ? b.query.trim() : "";

  if (!userQuery) {
    return NextResponse.json(
      {
        error:
          'Body must be a JSON object with a non-empty string "query" field',
        sql: null,
        data: [],
        explanation: "",
        entities: [],
      },
      { status: 400 }
    );
  }

  const llm = await generateSqlFromQuestion(userQuery);

  if (!llm.ok) {
    if (llm.reason === "invalid_question") {
      return NextResponse.json(
        {
          sql: "INVALID_QUERY",
          data: [] as unknown[],
          explanation: llm.explanation,
          entities: [],
        },
        { status: 400 }
      );
    }

    const needsConfig =
      llm.explanation.includes("LLM_API_KEY") ||
      llm.explanation.includes("not configured");

    return NextResponse.json(
      {
        error: llm.explanation,
        sql: null,
        data: [] as unknown[],
        explanation: "",
        entities: [],
      },
      { status: needsConfig ? 503 : 502 }
    );
  }

  if (!process.env.DATABASE_URL?.trim()) {
    return NextResponse.json(
      {
        error:
          "DATABASE_URL is not set. Add the Postgres connection URI from Supabase (Settings → Database) to run generated SQL.",
        sql: llm.sql,
        data: [] as unknown[],
        explanation: llm.explanation,
        entities: [],
      },
      { status: 503 }
    );
  }

  try {
    const data = await executeReadOnlySelect(llm.sql);
    const entities = extractEntitiesFromRows(data);
    console.log("Query API extracted entities:", entities);

    return NextResponse.json({
      sql: llm.sql,
      data,
      explanation: llm.explanation,
      entities,
    });
  } catch (sqlErr) {
    if (sqlErr instanceof SqlGuardError) {
      return NextResponse.json(
        {
          error: sqlErr.message,
          sql: llm.sql,
          data: [] as unknown[],
          explanation: llm.explanation,
          entities: [],
        },
        { status: 422 }
      );
    }

    const msg =
      sqlErr instanceof Error ? sqlErr.message : "SQL execution failed";
    return NextResponse.json(
      {
        error: msg,
        sql: llm.sql,
        data: [] as unknown[],
        explanation: llm.explanation,
        entities: [],
      },
      { status: 500 }
    );
  }
}

