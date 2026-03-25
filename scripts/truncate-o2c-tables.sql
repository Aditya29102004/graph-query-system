-- Run in SQL Editor before re-importing JSONL (respects FKs via CASCADE)
TRUNCATE TABLE
  payments_accounts_receivable,
  journal_entry_items_accounts_receivable,
  outbound_delivery_items,
  outbound_delivery_headers,
  billing_document_items,
  billing_document_cancellations,
  billing_document_headers,
  sales_order_schedule_lines,
  sales_order_items,
  sales_order_headers,
  product_storage_locations,
  product_plants,
  product_descriptions,
  products,
  customer_sales_area_assignments,
  business_partner_addresses,
  customer_company_assignments,
  business_partners,
  plants
CASCADE;
