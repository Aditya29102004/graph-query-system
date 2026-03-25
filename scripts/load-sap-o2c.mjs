/**
 * Load sap-o2c-data JSONL into Supabase (service role bypasses RLS).
 *
 * Loads `.env.local` from the project root (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
 * Defaults SAP_O2C_DATA_DIR to `<project>/sap-o2c-data` if unset.
 *
 * Usage:
 *   npm run load-o2c
 *
 * Or set SAP_O2C_DATA_DIR and run: node scripts/load-sap-o2c.mjs
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createReadStream, existsSync } from "fs";
import { readdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import readline from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
config({ path: join(projectRoot, ".env.local"), quiet: true });
config({ path: join(projectRoot, ".env"), quiet: true });

const BATCH = 400;

const LOAD_ORDER = [
  "plants",
  "products",
  "product_descriptions",
  "product_plants",
  "product_storage_locations",
  "business_partners",
  "customer_company_assignments",
  "business_partner_addresses",
  "customer_sales_area_assignments",
  "sales_order_headers",
  "sales_order_items",
  "sales_order_schedule_lines",
  "billing_document_headers",
  "billing_document_cancellations",
  "billing_document_items",
  "outbound_delivery_headers",
  "outbound_delivery_items",
  "journal_entry_items_accounts_receivable",
  "payments_accounts_receivable",
];

function camelToSnake(s) {
  return s
    .replace(/([A-Z])/g, (_, c) => `_${c.toLowerCase()}`)
    .replace(/^_/, "");
}

/** Recurse into objects/arrays; keep leaf strings (SAP IDs may be "000010"). */
function transformValue(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === "boolean" || typeof v === "number" || typeof v === "string")
    return v;
  if (Array.isArray(v)) return v.map(transformValue);
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[camelToSnake(k)] = transformValue(val);
    }
    return out;
  }
  return v;
}

function rowToSnake(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[camelToSnake(k)] = transformValue(v);
  }
  return out;
}

async function* readJsonlFiles(dir) {
  const files = await readdir(dir).catch(() => []);
  const jsonl = files.filter((f) => f.endsWith(".jsonl")).sort();
  for (const f of jsonl) {
    const path = join(dir, f);
    const rl = readline.createInterface({
      input: createReadStream(path, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const t = line.trim();
      if (!t) continue;
      yield JSON.parse(t);
    }
  }
}

async function insertBatches(supabase, table, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) {
      throw new Error(`${table} batch ${i}: ${error.message} (${error.code})`);
    }
  }
}

async function main() {
  const dryRun =
    process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dataRoot =
    process.env.SAP_O2C_DATA_DIR ?? join(projectRoot, "sap-o2c-data");

  if (!existsSync(dataRoot)) {
    console.error(`Data folder not found: ${dataRoot}`);
    process.exit(1);
  }

  if (dryRun) {
    for (const folder of LOAD_ORDER) {
      const dir = join(dataRoot, folder);
      let n = 0;
      for await (const _ of readJsonlFiles(dir)) n++;
      console.log(`${folder}: ${n} rows`);
    }
    console.log("Dry run OK (no DB writes).");
    return;
  }

  if (!url || !key) {
    console.error(
      [
        "Missing Supabase URL or service role key.",
        "Add to .env.local:",
        "  NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co",
        "  SUPABASE_SERVICE_ROLE_KEY=<secret from Dashboard → Settings → API → service_role>",
        "Apply SQL migrations in supabase/migrations/ first (SQL Editor → paste → Run).",
      ].join("\n")
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  for (const folder of LOAD_ORDER) {
    const dir = join(dataRoot, folder);
    const rows = [];
    for await (const raw of readJsonlFiles(dir)) {
      rows.push(rowToSnake(raw));
    }
    if (rows.length === 0) {
      console.warn(`Skip empty: ${folder}`);
      continue;
    }
    const table = folder;
    console.log(`Insert ${rows.length} → ${table}`);
    await insertBatches(supabase, table, rows);
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
