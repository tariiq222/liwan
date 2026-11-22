-- The notes of one invoice are read by `invoice_id` in settlement, refunds, the invoice views and the AI top-up refund, and the
-- foreign key to `invoices` checks it on every invoice change. The only index that starts with the column is partial (one vendor
-- refund per invoice), so every other lookup scanned the whole table.
CREATE INDEX invoice_adjustments_invoice ON invoice_adjustments(invoice_id);
