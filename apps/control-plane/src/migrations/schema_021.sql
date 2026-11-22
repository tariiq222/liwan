-- Idempotent customer (plan-based tenant) creation: a retried request with the same
-- creation_request_id returns the original customer instead of creating a duplicate.
-- Additive and nullable; existing customers remain valid.
ALTER TABLE customers ADD COLUMN creation_request_id uuid UNIQUE;
ALTER TABLE customers ADD COLUMN creation_digest text;
ALTER TABLE customers ADD CONSTRAINT customers_creation_digest_required CHECK (creation_request_id IS NULL OR creation_digest IS NOT NULL);
