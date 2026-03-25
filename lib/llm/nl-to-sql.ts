/**
 * Natural language → SQL for SAP O2C tables (see supabase/migrations).
 * Model output: **only** a single SELECT (no trailing semicolon) or the token INVALID_QUERY.
 */

const SYSTEM_PROMPT = `You are working on a graph representing an Order-to-Cash system. Entities include orders, deliveries, invoices, payments, customers, and products. All answers must be derived from database queries and reflect actual relationships.

You are a senior data analyst.

You MUST generate valid PostgreSQL SELECT queries ONLY.

Schema mapping (public schema):
- sales_order_headers — orders. PK: sales_order (text). Columns include: sold_to_party, sales_order_type, sales_organization, distribution_channel, creation_date, total_net_amount, transaction_currency, pricing_date, requested_delivery_date, customer_payment_terms, incoterms_classification.
- outbound_delivery_headers — deliveries. PK: delivery_document (text). Columns include: shipping_point, creation_date, overall_goods_movement_status, overall_picking_status, delivery_block_reason.
- billing_document_headers — invoices. PK: billing_document (text). Columns include: sold_to_party, company_code, fiscal_year, accounting_document, billing_document_type, billing_document_date, total_net_amount, transaction_currency, billing_document_is_cancelled.
- payments_accounts_receivable — payments. PK: (company_code, fiscal_year, accounting_document, accounting_document_item). Columns include: customer, amount_in_transaction_currency, transaction_currency, posting_date, clearing_date, clearing_accounting_document, clearing_doc_fiscal_year, gl_account, invoice_reference.
- business_partners — customers. PK: business_partner (text). Columns include: business_partner_name, customer, business_partner_category, creation_date, business_partner_is_blocked.
- products — products. PK: product (text). Columns include: product_type, base_unit, product_group, gross_weight, division, is_marked_for_deletion.

Bridge / line tables (use explicit JOINs):
- sales_order_items: sales_order, sales_order_item, material (FK to products.product), net_amount, requested_quantity, production_plant, storage_location
- outbound_delivery_items: delivery_document, reference_sd_document (= sales order #), reference_sd_document_item, plant, storage_location, actual_delivery_quantity
- billing_document_items: billing_document, billing_document_item, material, reference_sd_document (= outbound delivery #), net_amount, billing_quantity

Rules:
- Always use explicit INNER JOIN / LEFT JOIN with ON conditions; never comma-joins.
- Never guess or invent column names — only use columns listed above or on those tables.
- For totals, counts, rankings: use COUNT / SUM / AVG with GROUP BY, and ORDER BY as needed.
- Always include LIMIT 100 on non-aggregation row listings (plain SELECT of rows). For aggregation queries (GROUP BY), you may use LIMIT 10 or LIMIT 100 on the grouped result as appropriate.
- One statement only; no semicolon at the end; no comments; no markdown.
- If the question is ambiguous, not answerable with this schema, or unrelated → respond with exactly: INVALID_QUERY

Few-shot examples (column names match the real schema):

Q: Which products appear on the most billing documents?
SQL:
SELECT bi.material AS product
     , COUNT(DISTINCT bi.billing_document) AS invoice_count
FROM billing_document_items bi
INNER JOIN products p ON p.product = bi.material
GROUP BY bi.material
ORDER BY invoice_count DESC
LIMIT 10

Q: Which sales orders have no outbound delivery line referencing them?
SQL:
SELECT o.sales_order
FROM sales_order_headers o
LEFT JOIN (
  SELECT DISTINCT reference_sd_document
  FROM outbound_delivery_items
) di ON di.reference_sd_document = o.sales_order
WHERE di.reference_sd_document IS NULL
LIMIT 100

Q: Total payment amount in transaction currency by customer?
SQL:
SELECT par.customer
     , SUM(par.amount_in_transaction_currency) AS total_paid
FROM payments_accounts_receivable par
INNER JOIN business_partners bp ON bp.business_partner = par.customer
GROUP BY par.customer
ORDER BY total_paid DESC
LIMIT 10

Return ONLY SQL or INVALID_QUERY.`;

export type LlmSqlResult =
  | { ok: true; sql: string; explanation: string; raw: string }
  | { ok: false; reason: "invalid_question"; explanation: string; raw: string }
  | { ok: false; reason: "llm_error"; explanation: string; raw?: string };

type Provider = "openrouter" | "gemini";

function getProvider(apiKey: string): Provider {
  const explicit = (process.env.LLM_PROVIDER ?? "").toLowerCase().trim();
  // Provider auto-detection: key prefix wins (prevents wrong headers).
  if (apiKey.startsWith("AIza")) return "gemini";
  if (apiKey.toLowerCase().startsWith("sk-or-")) return "openrouter";

  if (explicit === "gemini") return "gemini";
  if (explicit === "openrouter") return "openrouter";

  return "openrouter";
}

function stripCodeFences(text: string): string {
  let t = text.trim();
  const block = /^```(?:sql)?\s*\r?\n([\s\S]*?)\r?\n```$/i;
  const m = t.match(block);
  if (m) return m[1].trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:sql)?\s*/i, "");
    t = t.replace(/\s*```\s*$/i, "");
  }
  return t.trim();
}

function parseModelResponse(content: string): LlmSqlResult {
  const raw = content.trim();
  if (!raw) {
    return {
      ok: false,
      reason: "llm_error",
      explanation: "Empty model response",
      raw,
    };
  }

  let body = stripCodeFences(raw);

  if (/^INVALID_QUERY$/i.test(body)) {
    return {
      ok: false,
      reason: "invalid_question",
      explanation:
        "The model could not produce a safe query for this question (out of scope or ambiguous).",
      raw,
    };
  }

  // Backward compatibility: JSON { "sql", "explanation" }
  if (body.startsWith("{")) {
    try {
      const obj = JSON.parse(body) as { sql?: unknown; explanation?: unknown };
      const sqlVal = obj.sql;
      const expl = String(obj.explanation ?? "").trim();
      if (
        sqlVal === "INVALID_QUERY" ||
        (typeof sqlVal === "string" &&
          sqlVal.trim().toUpperCase() === "INVALID_QUERY")
      ) {
        return {
          ok: false,
          reason: "invalid_question",
          explanation: expl || "Question is outside supported domain.",
          raw,
        };
      }
      if (typeof sqlVal === "string" && sqlVal.trim()) {
        const sql = stripCodeFences(sqlVal).replace(/;+\s*$/, "").trim();
        if (/^select\b/i.test(sql)) {
          return {
            ok: true,
            sql,
            explanation: expl,
            raw,
          };
        }
      }
    } catch {
      /* fall through to raw SQL */
    }
  }

  body = body.replace(/;+\s*$/, "").trim();

  if (!/^select\b/i.test(body)) {
    return {
      ok: false,
      reason: "llm_error",
      explanation:
        "Model must respond with a single SELECT statement or INVALID_QUERY.",
      raw,
    };
  }

  return {
    ok: true,
    sql: body,
    explanation: "",
    raw,
  };
}

function normalizeMessageContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: string }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

async function openRouterComplete(apiKey: string, userQuestion: string) {
  const model = process.env.LLM_MODEL ?? "google/gemini-2.0-flash-001";

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(process.env.OPENROUTER_APP_URL
        ? { "HTTP-Referer": process.env.OPENROUTER_APP_URL }
        : {}),
      ...(process.env.OPENROUTER_APP_TITLE
        ? { "X-Title": process.env.OPENROUTER_APP_TITLE }
        : { "X-Title": "graph-query-system" }),
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userQuestion },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenRouter HTTP ${res.status}: ${t.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: {
      message?: { content?: string | Array<{ text?: string } | unknown> };
    }[];
  };
  const content = data.choices?.[0]?.message?.content;
  const text = normalizeMessageContent(content);
  if (!text) {
    throw new Error("OpenRouter: no message content");
  }
  return text;
}

async function geminiComplete(apiKey: string, userQuestion: string) {
  const model = process.env.LLM_MODEL ?? "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [{ text: userQuestion }],
        },
      ],
      generationConfig: { temperature: 0.1 },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${t.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
    "";
  if (!text) throw new Error("Gemini: no text in response");
  return text;
}

export async function generateSqlFromQuestion(
  userQuestion: string
): Promise<LlmSqlResult> {
  const apiKey = process.env.LLM_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      reason: "llm_error",
      explanation: "LLM_API_KEY is not configured",
    };
  }

  const q = userQuestion.trim();
  if (!q) {
    return {
      ok: false,
      reason: "invalid_question",
      explanation: "Query text is required",
      raw: "",
    };
  }

  let content: string;
  try {
    if (getProvider(apiKey) === "gemini") {
      content = await geminiComplete(apiKey, q);
    } else {
      content = await openRouterComplete(apiKey, q);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LLM request failed";
    return { ok: false, reason: "llm_error", explanation: msg };
  }

  return parseModelResponse(content);
}
