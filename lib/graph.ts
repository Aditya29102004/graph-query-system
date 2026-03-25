import { createSupabaseServerClient } from "@/app/lib/supabase/server";
import { toGraphNodeId } from "./graph/entities";

export type GraphNode = { id: string; label: string; type: string };
export type GraphEdge = { source: string; target: string; label: string };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

type NormalizedEntity =
  | "order"
  | "delivery"
  | "invoice"
  | "payment"
  | "customer"
  | "product"
  | "order_item";

/** Node id prefixes (avoids collisions between SAP number ranges). */
const I = {
  order: (salesOrder: string) => `order:${salesOrder}`,
  delivery: (doc: string) => `delivery:${doc}`,
  invoice: (doc: string) => `invoice:${doc}`,
  payment: (
    companyCode: string,
    fiscalYearCd: string,
    accDoc: string,
    item: string
  ) => `payment:${companyCode}:${fiscalYearCd}:${accDoc}:${item}`,
  customer: (bp: string) => `customer:${bp}`,
  product: (sku: string) => `product:${sku}`,
  orderItem: (salesOrder: string, line: string) =>
    `order_item:${salesOrder}:${line}`,
} as const;

class GraphBuilder {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges: GraphEdge[] = [];

  addNode(node: GraphNode) {
    if (!this.nodes.has(node.id)) this.nodes.set(node.id, node);
  }

  addEdge(source: string, target: string, label: string) {
    if (source === target) return;
    if (this.edges.some((e) => e.source === source && e.target === target && e.label === label))
      return;
    this.edges.push({ source, target, label });
  }

  build(): GraphData {
    return {
      nodes: [...this.nodes.values()],
      edges: this.edges,
    };
  }
}

function normalizeEntityType(entityType: string): NormalizedEntity | null {
  const t = entityType.trim().toLowerCase().replace(/-/g, "_");
  if (t === "order" || t === "sales_order") return "order";
  if (t === "delivery" || t === "outbound_delivery") return "delivery";
  if (t === "invoice" || t === "billing" || t === "billing_document") return "invoice";
  if (t === "payment" || t === "ar_payment") return "payment";
  if (t === "customer" || t === "business_partner" || t === "sold_to_party")
    return "customer";
  if (t === "product" || t === "material") return "product";
  if (t === "order_item" || t === "line_item" || t === "sales_order_item")
    return "order_item";
  return null;
}

function parsePaymentEntityId(entityId: string) {
  const parts = entityId.split(":").map((p) => p.trim());
  if (parts.length === 4) {
    return {
      company_code: parts[0],
      fiscal_year: parts[1],
      accounting_document: parts[2],
      accounting_document_item: parts[3],
    };
  }
  return null;
}

function parseOrderItemEntityId(entityId: string) {
  const idx = entityId.indexOf(":");
  if (idx <= 0) return null;
  return {
    sales_order: entityId.slice(0, idx).trim(),
    sales_order_item: entityId.slice(idx + 1).trim(),
  };
}

async function productLabel(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  productId: string
): Promise<string> {
  const { data } = await supabase
    .from("product_descriptions")
    .select("product_description")
    .eq("product", productId)
    .eq("language", "EN")
    .maybeSingle();
  const desc = data?.product_description?.trim();
  return desc ? `${productId} · ${desc}` : productId;
}

async function customerLabel(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  customerId: string
): Promise<string> {
  const { data } = await supabase
    .from("business_partners")
    .select("business_partner_name")
    .eq("business_partner", customerId)
    .maybeSingle();
  const name = data?.business_partner_name?.trim();
  return name ? `${customerId} · ${name}` : customerId;
}

async function paymentsForInvoice(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  billingDocument: string
) {
  const { data: journalRows } = await supabase
    .from("journal_entry_items_accounts_receivable")
    .select(
      "company_code, fiscal_year, clearing_accounting_document, clearing_doc_fiscal_year"
    )
    .eq("reference_document", billingDocument)
    .not("clearing_accounting_document", "is", null);

  const keys = new Map<
    string,
    {
      company_code: string;
      fiscal_year: string;
      clearing_accounting_document: string;
      clearing_doc_fiscal_year: string;
    }
  >();
  for (const row of journalRows ?? []) {
    if (
      !row.company_code ||
      !row.fiscal_year ||
      !row.clearing_accounting_document ||
      !row.clearing_doc_fiscal_year
    )
      continue;
    const k = `${row.company_code}|${row.fiscal_year}|${row.clearing_accounting_document}|${row.clearing_doc_fiscal_year}`;
    keys.set(k, {
      company_code: row.company_code,
      fiscal_year: row.fiscal_year,
      clearing_accounting_document: row.clearing_accounting_document,
      clearing_doc_fiscal_year: row.clearing_doc_fiscal_year,
    });
  }

  const payments: Record<
    string,
    {
      company_code: string;
      fiscal_year: string;
      accounting_document: string;
      accounting_document_item: string;
    }
  > = {};

  for (const k of keys.values()) {
    const { data: payRows } = await supabase
      .from("payments_accounts_receivable")
      .select(
        "company_code, fiscal_year, accounting_document, accounting_document_item"
      )
      .eq("company_code", k.company_code)
      .eq("fiscal_year", k.fiscal_year)
      .eq("clearing_accounting_document", k.clearing_accounting_document)
      .eq("clearing_doc_fiscal_year", k.clearing_doc_fiscal_year);

    for (const p of payRows ?? []) {
      if (
        !p.company_code ||
        !p.fiscal_year ||
        !p.accounting_document ||
        !p.accounting_document_item
      )
        continue;
      const id = I.payment(
        p.company_code,
        p.fiscal_year,
        p.accounting_document,
        p.accounting_document_item
      );
      payments[id] = {
        company_code: p.company_code,
        fiscal_year: p.fiscal_year,
        accounting_document: p.accounting_document,
        accounting_document_item: p.accounting_document_item,
      };
    }
  }

  return Object.values(payments);
}

async function invoicesForDelivery(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  deliveryDocument: string
) {
  const { data } = await supabase
    .from("billing_document_items")
    .select("billing_document")
    .eq("reference_sd_document", deliveryDocument);

  return [...new Set((data ?? []).map((r) => r.billing_document).filter(Boolean))] as string[];
}

async function deliveriesForOrder(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  salesOrder: string
) {
  const { data } = await supabase
    .from("outbound_delivery_items")
    .select("delivery_document")
    .eq("reference_sd_document", salesOrder);

  return [...new Set((data ?? []).map((r) => r.delivery_document).filter(Boolean))] as string[];
}

async function ordersForDelivery(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  deliveryDocument: string
) {
  const { data } = await supabase
    .from("outbound_delivery_items")
    .select("reference_sd_document")
    .eq("delivery_document", deliveryDocument);

  return [
    ...new Set((data ?? []).map((r) => r.reference_sd_document).filter(Boolean)),
  ] as string[];
}

async function deliveriesForInvoice(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  billingDocument: string
) {
  const { data } = await supabase
    .from("billing_document_items")
    .select("reference_sd_document")
    .eq("billing_document", billingDocument);

  return [
    ...new Set((data ?? []).map((r) => r.reference_sd_document).filter(Boolean)),
  ] as string[];
}

async function expandInvoicesChain(
  g: GraphBuilder,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  billingDocumentIds: string[]
) {
  for (const invId of billingDocumentIds) {
    const { data: hdr } = await supabase
      .from("billing_document_headers")
      .select("billing_document")
      .eq("billing_document", invId)
      .maybeSingle();
    if (!hdr) continue;
    g.addNode({
      id: I.invoice(invId),
      label: `Invoice ${invId}`,
      type: "invoice",
    });

    const pays = await paymentsForInvoice(supabase, invId);
    for (const p of pays) {
      const pid = I.payment(
        p.company_code,
        p.fiscal_year,
        p.accounting_document,
        p.accounting_document_item
      );
      g.addNode({
        id: pid,
        label: `Payment ${p.accounting_document}/${p.accounting_document_item}`,
        type: "payment",
      });
      g.addEdge(I.invoice(invId), pid, "paid_by");
    }
  }
}

async function expandFromOrder(
  g: GraphBuilder,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  salesOrder: string
) {
  const { data: header } = await supabase
    .from("sales_order_headers")
    .select("sales_order, sold_to_party")
    .eq("sales_order", salesOrder)
    .maybeSingle();

  if (!header) return;

  g.addNode({
    id: I.order(salesOrder),
    label: `Order ${salesOrder}`,
    type: "order",
  });

  if (header.sold_to_party) {
    const cl = await customerLabel(supabase, header.sold_to_party);
    g.addNode({
      id: I.customer(header.sold_to_party),
      label: cl,
      type: "customer",
    });
    g.addEdge(I.order(salesOrder), I.customer(header.sold_to_party), "sold_to");
  }

  const deliveryIds = await deliveriesForOrder(supabase, salesOrder);
  for (const dId of deliveryIds) {
    g.addNode({
      id: I.delivery(dId),
      label: `Delivery ${dId}`,
      type: "delivery",
    });
    g.addEdge(I.order(salesOrder), I.delivery(dId), "fulfilled_by");

    const invIds = await invoicesForDelivery(supabase, dId);
    for (const invId of invIds) {
      g.addEdge(I.delivery(dId), I.invoice(invId), "invoiced_as");
    }
    await expandInvoicesChain(g, supabase, invIds);
  }

  const { data: lines } = await supabase
    .from("sales_order_items")
    .select("sales_order, sales_order_item, material")
    .eq("sales_order", salesOrder);

  for (const line of lines ?? []) {
    if (!line.material) continue;
    const oid = I.orderItem(line.sales_order, line.sales_order_item);
    g.addNode({
      id: oid,
      label: `Line ${line.sales_order_item}`,
      type: "order_item",
    });
    g.addEdge(I.order(salesOrder), oid, "contains");

    const pl = await productLabel(supabase, line.material);
    g.addNode({
      id: I.product(line.material),
      label: pl,
      type: "product",
    });
    g.addEdge(oid, I.product(line.material), "references_product");
  }
}

async function expandFromDelivery(
  g: GraphBuilder,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  deliveryDocument: string
) {
  const { data: hdr } = await supabase
    .from("outbound_delivery_headers")
    .select("delivery_document")
    .eq("delivery_document", deliveryDocument)
    .maybeSingle();
  if (!hdr) return;

  g.addNode({
    id: I.delivery(deliveryDocument),
    label: `Delivery ${deliveryDocument}`,
    type: "delivery",
  });

  const orderIds = await ordersForDelivery(supabase, deliveryDocument);
  for (const ord of orderIds) {
    g.addNode({
      id: I.order(ord),
      label: `Order ${ord}`,
      type: "order",
    });
    g.addEdge(I.order(ord), I.delivery(deliveryDocument), "fulfilled_by");
  }

  const invIds = await invoicesForDelivery(supabase, deliveryDocument);
  for (const invId of invIds) {
    g.addEdge(I.delivery(deliveryDocument), I.invoice(invId), "invoiced_as");
  }
  await expandInvoicesChain(g, supabase, invIds);
}

async function expandFromInvoice(
  g: GraphBuilder,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  billingDocument: string
) {
  const { data: hdr } = await supabase
    .from("billing_document_headers")
    .select("billing_document, sold_to_party")
    .eq("billing_document", billingDocument)
    .maybeSingle();
  if (!hdr) return;

  g.addNode({
    id: I.invoice(billingDocument),
    label: `Invoice ${billingDocument}`,
    type: "invoice",
  });

  if (hdr.sold_to_party) {
    const cl = await customerLabel(supabase, hdr.sold_to_party);
    g.addNode({
      id: I.customer(hdr.sold_to_party),
      label: cl,
      type: "customer",
    });
    g.addEdge(I.invoice(billingDocument), I.customer(hdr.sold_to_party), "bill_to");
  }

  const delIds = await deliveriesForInvoice(supabase, billingDocument);
  for (const dId of delIds) {
    g.addNode({
      id: I.delivery(dId),
      label: `Delivery ${dId}`,
      type: "delivery",
    });
    g.addEdge(I.delivery(dId), I.invoice(billingDocument), "invoiced_as");
    const orderIds = await ordersForDelivery(supabase, dId);
    for (const ord of orderIds) {
      g.addNode({
        id: I.order(ord),
        label: `Order ${ord}`,
        type: "order",
      });
      g.addEdge(I.order(ord), I.delivery(dId), "fulfilled_by");
    }
  }

  await expandInvoicesChain(g, supabase, [billingDocument]);
}

async function expandFromPayment(
  g: GraphBuilder,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  parts: NonNullable<ReturnType<typeof parsePaymentEntityId>>
) {
  const { data: row } = await supabase
    .from("payments_accounts_receivable")
    .select("*")
    .eq("company_code", parts.company_code)
    .eq("fiscal_year", parts.fiscal_year)
    .eq("accounting_document", parts.accounting_document)
    .eq("accounting_document_item", parts.accounting_document_item)
    .maybeSingle();

  if (!row) return;

  const pid = I.payment(
    parts.company_code,
    parts.fiscal_year,
    parts.accounting_document,
    parts.accounting_document_item
  );
  g.addNode({
    id: pid,
    label: `Payment ${parts.accounting_document}/${parts.accounting_document_item}`,
    type: "payment",
  });

  const clearDoc = row.clearing_accounting_document;
  const clearFY = row.clearing_doc_fiscal_year;
  if (!clearDoc || !clearFY) return;

  const { data: journals } = await supabase
    .from("journal_entry_items_accounts_receivable")
    .select("reference_document")
    .eq("company_code", parts.company_code)
    .eq("fiscal_year", parts.fiscal_year)
    .eq("clearing_accounting_document", clearDoc)
    .eq("clearing_doc_fiscal_year", clearFY);

  const invIds = [
    ...new Set(
      (journals ?? [])
        .map((j) => j.reference_document)
        .filter((x): x is string => Boolean(x))
    ),
  ];

  for (const invId of invIds) {
    g.addEdge(I.invoice(invId), pid, "paid_by");
  }
  await expandInvoicesChain(g, supabase, invIds);
}

async function expandFromCustomer(
  g: GraphBuilder,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  customerId: string
) {
  const cl = await customerLabel(supabase, customerId);
  g.addNode({
    id: I.customer(customerId),
    label: cl,
    type: "customer",
  });

  const { data: orders } = await supabase
    .from("sales_order_headers")
    .select("sales_order")
    .eq("sold_to_party", customerId);

  for (const o of orders ?? []) {
    await expandFromOrder(g, supabase, o.sales_order);
    g.addEdge(I.customer(customerId), I.order(o.sales_order), "places");
  }
}

async function expandFromProduct(
  g: GraphBuilder,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  productId: string
) {
  const pl = await productLabel(supabase, productId);
  g.addNode({
    id: I.product(productId),
    label: pl,
    type: "product",
  });

  const { data: lines } = await supabase
    .from("sales_order_items")
    .select("sales_order, sales_order_item, material")
    .eq("material", productId);

  for (const line of lines ?? []) {
    await expandFromOrder(g, supabase, line.sales_order);
    const oid = I.orderItem(line.sales_order, line.sales_order_item);
    g.addEdge(oid, I.product(productId), "references_product");
  }
}

async function expandFromOrderItem(
  g: GraphBuilder,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  salesOrder: string,
  line: string
) {
  const { data: row } = await supabase
    .from("sales_order_items")
    .select("sales_order, sales_order_item, material")
    .eq("sales_order", salesOrder)
    .eq("sales_order_item", line)
    .maybeSingle();

  if (!row?.material) return;

  await expandFromOrder(g, supabase, salesOrder);

  const oid = I.orderItem(salesOrder, line);
  g.addNode({
    id: oid,
    label: `Line ${line}`,
    type: "order_item",
  });
  g.addEdge(I.order(salesOrder), oid, "contains");

  const pl = await productLabel(supabase, row.material);
  g.addNode({
    id: I.product(row.material),
    label: pl,
    type: "product",
  });
  g.addEdge(oid, I.product(row.material), "references_product");
}

/**
 * Build a connected graph from a list of entities, showing relationships between them.
 */
export async function getConnectedGraphData(
  entities: Array<{ type: string; id: string }>
): Promise<GraphData> {
  console.log("getConnectedGraphData called with entities:", entities);

  if (entities.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Limit input to 10 entities for performance (FAST MODE)
  const limitedEntities = entities.slice(0, 10);
  if (limitedEntities.length < entities.length) {
    console.log(`Limited entities from ${entities.length} to ${limitedEntities.length} for performance`);
  }

  const supabase = await createSupabaseServerClient();
  const g = new GraphBuilder();

  // For each entity, expand it to get its neighbors and build the full graph
  for (const entity of limitedEntities) {
    const kind = normalizeEntityType(entity.type);
    console.log("Processing entity:", entity, "normalized type:", kind);
    if (!kind) continue;

    try {
      switch (kind) {
        case "order":
          await expandFromOrder(g, supabase, entity.id);
          break;
        case "delivery":
          await expandFromDelivery(g, supabase, entity.id);
          break;
        case "invoice":
          await expandFromInvoice(g, supabase, entity.id);
          break;
        case "payment": {
          const parts = parsePaymentEntityId(entity.id);
          if (parts) await expandFromPayment(g, supabase, parts);
          break;
        }
        case "customer":
          await expandFromCustomer(g, supabase, entity.id);
          break;
        case "product":
          await expandFromProduct(g, supabase, entity.id);
          break;
        case "order_item": {
          const parsed = parseOrderItemEntityId(entity.id);
          if (parsed)
            await expandFromOrderItem(
              g,
              supabase,
              parsed.sales_order,
              parsed.sales_order_item
            );
          break;
        }
        default:
          // Just add the node if we can't expand it
          let nodeId: string;
          let label: string;

          switch (kind) {
            case "order":
              nodeId = I.order(entity.id);
              label = `Order ${entity.id}`;
              break;
            case "delivery":
              nodeId = I.delivery(entity.id);
              label = `Delivery ${entity.id}`;
              break;
            case "invoice":
              nodeId = I.invoice(entity.id);
              label = `Invoice ${entity.id}`;
              break;
            case "payment": {
              const parts = parsePaymentEntityId(entity.id);
              if (!parts) continue;
              nodeId = I.payment(
                parts.company_code,
                parts.fiscal_year,
                parts.accounting_document,
                parts.accounting_document_item
              );
              label = `Payment ${parts.accounting_document}/${parts.accounting_document_item}`;
              break;
            }
            case "customer":
              nodeId = I.customer(entity.id);
              label = await customerLabel(supabase, entity.id);
              break;
            case "product":
              nodeId = I.product(entity.id);
              label = await productLabel(supabase, entity.id);
              break;
            case "order_item": {
              const parsed = parseOrderItemEntityId(entity.id);
              if (!parsed) continue;
              nodeId = I.orderItem(parsed.sales_order, parsed.sales_order_item);
              label = `Line ${parsed.sales_order_item}`;
              break;
            }
            default:
              continue;
          }

          g.addNode({
            id: nodeId,
            label,
            type: kind,
          });
      }
    } catch (error) {
      console.error(`Error expanding entity ${entity.type}:${entity.id}:`, error);
      // Still add the node even if expansion fails
      const nodeId = `${entity.type}:${entity.id}`;
      g.addNode({
        id: nodeId,
        label: `${entity.type} ${entity.id}`,
        type: entity.type,
      });
    }
  }

  // If we still have no edges, try to find relationships between the entities
  const graphData = g.build();
  if (graphData.edges.length === 0 && limitedEntities.length > 1) {
    console.log("No edges found, trying to build relationships between entities");

    // Try to find relationships between the entities we have
    await buildRelationshipsBetweenEntities(g, supabase, limitedEntities);
  }

  const finalGraph = g.build();
  console.log("Final graph:", {
    nodes: finalGraph.nodes.length,
    edges: finalGraph.edges.length
  });

  // Limit graph size to 10 nodes for performance
  const maxNodes = 10;
  if (finalGraph.nodes.length > maxNodes) {
    console.log(`Limiting graph from ${finalGraph.nodes.length} to ${maxNodes} nodes`);
    const limitedNodes = finalGraph.nodes.slice(0, maxNodes);
    const nodeIds = new Set(limitedNodes.map(n => n.id));
    const limitedEdges = finalGraph.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

    return {
      nodes: limitedNodes,
      edges: limitedEdges
    };
  }

  return finalGraph;
}

async function buildRelationshipsBetweenEntities(
  g: GraphBuilder,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  entities: Array<{ type: string; id: string }>
) {
  console.log("Building relationships between entities:", entities);

  // Group entities by type
  const orders = entities.filter(e => normalizeEntityType(e.type) === "order");
  const deliveries = entities.filter(e => normalizeEntityType(e.type) === "delivery");
  const invoices = entities.filter(e => normalizeEntityType(e.type) === "invoice");
  const payments = entities.filter(e => normalizeEntityType(e.type) === "payment");
  const customers = entities.filter(e => normalizeEntityType(e.type) === "customer");
  const products = entities.filter(e => normalizeEntityType(e.type) === "product");

  try {
    // 1. Connect orders to deliveries via outbound_delivery_items
    if (orders.length > 0 && deliveries.length > 0) {
      const orderIds = orders.map(e => e.id);
      const deliveryIds = deliveries.map(e => e.id);

      const { data: deliveryItems } = await supabase
        .from("outbound_delivery_items")
        .select("reference_sd_document, delivery_document")
        .in("reference_sd_document", orderIds)
        .in("delivery_document", deliveryIds);

      for (const item of deliveryItems ?? []) {
        if (item.reference_sd_document && item.delivery_document) {
          g.addEdge(
            I.order(item.reference_sd_document),
            I.delivery(item.delivery_document),
            "fulfilled_by"
          );
        }
      }
    }

    // 2. Connect deliveries to invoices via billing_document_items
    if (deliveries.length > 0 && invoices.length > 0) {
      const deliveryIds = deliveries.map(e => e.id);
      const invoiceIds = invoices.map(e => e.id);

      const { data: billingItems } = await supabase
        .from("billing_document_items")
        .select("reference_sd_document, billing_document")
        .in("reference_sd_document", deliveryIds)
        .in("billing_document", invoiceIds);

      for (const item of billingItems ?? []) {
        if (item.reference_sd_document && item.billing_document) {
          g.addEdge(
            I.delivery(item.reference_sd_document),
            I.invoice(item.billing_document),
            "invoiced_as"
          );
        }
      }
    }

    // 3. Connect invoices to payments via payments_accounts_receivable
    if (invoices.length > 0 && payments.length > 0) {
      const invoiceIds = invoices.map(e => e.id);

      const { data: paymentItems } = await supabase
        .from("payments_accounts_receivable")
        .select("company_code, fiscal_year, accounting_document, accounting_document_item, invoice_reference")
        .in("invoice_reference", invoiceIds);

      for (const item of paymentItems ?? []) {
        if (item.invoice_reference && item.company_code && item.fiscal_year &&
            item.accounting_document && item.accounting_document_item) {
          // Check if this payment is in our entities list
          const paymentId = `${item.company_code}:${item.fiscal_year}:${item.accounting_document}:${item.accounting_document_item}`;
          if (payments.some(p => p.id === paymentId)) {
            g.addEdge(
              I.invoice(item.invoice_reference),
              I.payment(item.company_code, item.fiscal_year, item.accounting_document, item.accounting_document_item),
              "paid_by"
            );
          }
        }
      }
    }

    // 4. Connect orders to customers via sales_order_headers
    if (orders.length > 0 && customers.length > 0) {
      const orderIds = orders.map(e => e.id);
      const customerIds = customers.map(e => e.id);

      const { data: orderHeaders } = await supabase
        .from("sales_order_headers")
        .select("sales_order, sold_to_party")
        .in("sales_order", orderIds)
        .in("sold_to_party", customerIds);

      for (const header of orderHeaders ?? []) {
        if (header.sales_order && header.sold_to_party) {
          g.addEdge(
            I.order(header.sales_order),
            I.customer(header.sold_to_party),
            "sold_to"
          );
        }
      }
    }

    // 5. Connect orders to products via sales_order_items
    if (orders.length > 0 && products.length > 0) {
      const orderIds = orders.map(e => e.id);
      const productIds = products.map(e => e.id);

      const { data: orderItems } = await supabase
        .from("sales_order_items")
        .select("sales_order, material")
        .in("sales_order", orderIds)
        .in("material", productIds);

      for (const item of orderItems ?? []) {
        if (item.sales_order && item.material) {
          g.addEdge(
            I.order(item.sales_order),
            I.product(item.material),
            "contains"
          );
        }
      }
    }

    // 6. Try to find indirect relationships (e.g., orders connected via shared customers)
    if (orders.length > 1) {
      await connectOrdersViaSharedEntities(g, supabase, orders);
    }

    console.log("Relationships built, current edges:", g.build().edges.length);

  } catch (error) {
    console.error("Error building relationships:", error);
    // Fallback: create artificial connections based on entity types
    createFallbackConnections(g, entities);
  }
}

async function connectOrdersViaSharedEntities(
  g: GraphBuilder,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  orders: Array<{ type: string; id: string }>
) {
  // Try to connect orders that share customers
  const orderIds = orders.map(e => e.id);

  const { data: orderHeaders } = await supabase
    .from("sales_order_headers")
    .select("sales_order, sold_to_party")
    .in("sales_order", orderIds);

  const customerToOrders = new Map<string, string[]>();
  for (const header of orderHeaders ?? []) {
    if (header.sales_order && header.sold_to_party) {
      if (!customerToOrders.has(header.sold_to_party)) {
        customerToOrders.set(header.sold_to_party, []);
      }
      customerToOrders.get(header.sold_to_party)!.push(header.sales_order);
    }
  }

  // Connect orders that share customers
  for (const [customer, orderList] of customerToOrders) {
    if (orderList.length > 1) {
      for (let i = 0; i < orderList.length - 1; i++) {
        for (let j = i + 1; j < orderList.length; j++) {
          g.addEdge(
            I.order(orderList[i]),
            I.order(orderList[j]),
            "same_customer"
          );
        }
      }
    }
  }
}

function createFallbackConnections(g: GraphBuilder, entities: Array<{ type: string; id: string }>) {
  console.log("Creating fallback connections");

  const orders = entities.filter(e => normalizeEntityType(e.type) === "order");
  const deliveries = entities.filter(e => normalizeEntityType(e.type) === "delivery");
  const invoices = entities.filter(e => normalizeEntityType(e.type) === "invoice");
  const payments = entities.filter(e => normalizeEntityType(e.type) === "payment");
  const customers = entities.filter(e => normalizeEntityType(e.type) === "customer");
  const products = entities.filter(e => normalizeEntityType(e.type) === "product");

  // Connect each order to each delivery
  orders.forEach(order => {
    deliveries.forEach(delivery => {
      g.addEdge(I.order(order.id), I.delivery(delivery.id), "fulfilled_by");
    });
  });

  // Connect each delivery to each invoice
  deliveries.forEach(delivery => {
    invoices.forEach(invoice => {
      g.addEdge(I.delivery(delivery.id), I.invoice(invoice.id), "invoiced_as");
    });
  });

  // Connect each invoice to each payment
  invoices.forEach(invoice => {
    payments.forEach(payment => {
      const parts = parsePaymentEntityId(payment.id);
      if (parts) {
        g.addEdge(I.invoice(invoice.id), I.payment(
          parts.company_code,
          parts.fiscal_year,
          parts.accounting_document,
          parts.accounting_document_item
        ), "paid_by");
      }
    });
  });

  // Connect each order to each customer
  orders.forEach(order => {
    customers.forEach(customer => {
      g.addEdge(I.order(order.id), I.customer(customer.id), "sold_to");
    });
  });

  // Connect each order to each product
  orders.forEach(order => {
    products.forEach(product => {
      g.addEdge(I.order(order.id), I.product(product.id), "contains");
    });
  });

  console.log("Fallback connections created");
}

/**
 * Build a graph neighborhood for an O2C entity using Supabase.
 *
 * `entityId` formats:
 * - order: sales order number, e.g. `"740506"`
 * - delivery / invoice: document number
 * - payment: `"companyCode:fiscalYear:accountingDocument:lineItem"` e.g. `"ABCD:2025:9400000220:1"`
 * - customer: business partner number
 * - product: material / product number
 * - order_item: `"salesOrder:lineItem"` e.g. `"740506:10"`
 */
export async function getGraphData(
  entityType: string,
  entityId: string
): Promise<GraphData> {
  const kind = normalizeEntityType(entityType);
  if (!kind) return { nodes: [], edges: [] };

  const supabase = await createSupabaseServerClient();
  const g = new GraphBuilder();

  switch (kind) {
    case "order":
      await expandFromOrder(g, supabase, entityId.trim());
      break;
    case "delivery":
      await expandFromDelivery(g, supabase, entityId.trim());
      break;
    case "invoice":
      await expandFromInvoice(g, supabase, entityId.trim());
      break;
    case "payment": {
      const parts = parsePaymentEntityId(entityId.trim());
      if (parts) await expandFromPayment(g, supabase, parts);
      break;
    }
    case "customer":
      await expandFromCustomer(g, supabase, entityId.trim());
      break;
    case "product":
      await expandFromProduct(g, supabase, entityId.trim());
      break;
    case "order_item": {
      const parsed = parseOrderItemEntityId(entityId.trim());
      if (parsed)
        await expandFromOrderItem(
          g,
          supabase,
          parsed.sales_order,
          parsed.sales_order_item
        );
      break;
    }
    default:
      return { nodes: [], edges: [] };
  }

  return g.build();
}
