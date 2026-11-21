-- The seller identity on a customer's invoice. The vendor enters it once in the billing settings (the same single row
-- as the bank account, audited the same way) and every invoice carries a copy of it as it stood when the invoice was
-- issued: `invoices.seller` is written by the insert and, because invoice_guard compares the whole row, can never
-- change afterwards. An invoice issued before this version (or while no legal name was set) has no copy and shows the
-- current identity instead. There is deliberately no tax field: the vendor is not VAT-registered.
ALTER TABLE billing_settings
  ADD COLUMN seller_legal_name_ar text NOT NULL DEFAULT '',
  ADD COLUMN seller_legal_name_en text NOT NULL DEFAULT '',
  ADD COLUMN seller_commercial_registration text NOT NULL DEFAULT '',
  ADD COLUMN seller_address text NOT NULL DEFAULT '',
  ADD COLUMN seller_city text NOT NULL DEFAULT '',
  ADD COLUMN seller_country text NOT NULL DEFAULT '',
  ADD COLUMN seller_email text NOT NULL DEFAULT '',
  ADD COLUMN seller_phone text NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN seller jsonb;
