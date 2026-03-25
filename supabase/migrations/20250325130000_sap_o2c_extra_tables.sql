-- Extra entities present under sap-o2c-data (business_partners, billing cancellations, customer–company)

CREATE TABLE IF NOT EXISTS business_partners (
  business_partner text PRIMARY KEY,
  customer text,
  business_partner_category text,
  business_partner_full_name text,
  business_partner_grouping text,
  business_partner_name text,
  correspondence_language text,
  created_by_user text,
  creation_date timestamptz,
  creation_time jsonb,
  first_name text,
  form_of_address text,
  industry text,
  last_change_date date,
  last_name text,
  organization_bp_name1 text,
  organization_bp_name2 text,
  business_partner_is_blocked boolean,
  is_marked_for_archiving boolean
);

CREATE TABLE IF NOT EXISTS customer_company_assignments (
  customer text NOT NULL,
  company_code text NOT NULL,
  accounting_clerk text,
  accounting_clerk_fax_number text,
  accounting_clerk_internet_address text,
  accounting_clerk_phone_number text,
  alternative_payer_account text,
  payment_blocking_reason text,
  payment_methods_list text,
  payment_terms text,
  reconciliation_account text,
  deletion_indicator boolean,
  customer_account_group text,
  PRIMARY KEY (customer, company_code)
);

CREATE TABLE IF NOT EXISTS billing_document_cancellations (
  billing_document text PRIMARY KEY,
  billing_document_type text,
  creation_date timestamptz,
  creation_time jsonb,
  last_change_date_time timestamptz,
  billing_document_date timestamptz,
  billing_document_is_cancelled boolean,
  cancelled_billing_document text,
  total_net_amount numeric,
  transaction_currency text,
  company_code text,
  fiscal_year text,
  accounting_document text,
  sold_to_party text
);

ALTER TABLE business_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_company_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_document_cancellations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read business_partners" ON business_partners FOR SELECT USING (true);
CREATE POLICY "Allow read customer_company_assignments" ON customer_company_assignments FOR SELECT USING (true);
CREATE POLICY "Allow read billing_document_cancellations" ON billing_document_cancellations FOR SELECT USING (true);
