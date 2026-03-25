import type { GraphEntity, GraphEntityType } from "./entities";

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return null;
}

function pushUnique(
  out: GraphEntity[],
  seen: Set<string>,
  type: GraphEntityType,
  id: string | null
) {
  if (!id) return;
  const key = `${type}:${id}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ type, id });
}

/**
 * Extract key entity IDs from the SQL result rows.
 * Heuristic-based: it relies on common identifier column names returned by the LLM.
 */
export function extractEntitiesFromRows(rows: unknown): GraphEntity[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const out: GraphEntity[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;

    const salesOrder =
      asString(row.sales_order) ??
      asString(row.order) ??
      asString(row.order_id) ??
      asString(row.salesOrder);
    pushUnique(out, seen, "order", salesOrder);

    const deliveryDocument =
      asString(row.delivery_document) ??
      asString(row.delivery) ??
      asString(row.delivery_id);
    pushUnique(out, seen, "delivery", deliveryDocument);

    const billingDocument =
      asString(row.billing_document) ??
      asString(row.invoice) ??
      asString(row.billing_id) ??
      asString(row.billing_document_id);
    pushUnique(out, seen, "invoice", billingDocument);

    const customer =
      asString(row.business_partner) ??
      asString(row.customer) ??
      asString(row.sold_to_party);
    pushUnique(out, seen, "customer", customer);

    const product =
      asString(row.product) ??
      asString(row.material) ??
      asString(row.product_id);
    pushUnique(out, seen, "product", product);

    const companyCode =
      asString(row.company_code) ?? asString(row.companyCode);
    const fiscalYear =
      asString(row.fiscal_year) ?? asString(row.fiscalYear);
    const accountingDocument =
      asString(row.accounting_document) ??
      asString(row.accountingDocument);
    const accountingDocumentItem =
      asString(row.accounting_document_item) ??
      asString(row.accountingDocumentItem);

    if (
      companyCode &&
      fiscalYear &&
      accountingDocument &&
      accountingDocumentItem
    ) {
      const paymentId = `${companyCode}:${fiscalYear}:${accountingDocument}:${accountingDocumentItem}`;
      pushUnique(out, seen, "payment", paymentId);
    }
  }

  return out;
}

