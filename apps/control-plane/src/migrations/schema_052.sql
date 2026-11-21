-- A customer says it made a bank transfer for one issued invoice. One claim per invoice (the invoice id is the key): a
-- second claim updates the same row. It never pays anything; the vendor still confirms the transfer by hand, and the
-- claim only matters while the invoice is `issued`, so no status is stored here.
CREATE TABLE bank_transfer_claims (
  invoice_id uuid PRIMARY KEY REFERENCES invoices(id),
  value_date date NOT NULL,
  sender_reference text CHECK (sender_reference IS NULL OR length(sender_reference) BETWEEN 1 AND 200),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
