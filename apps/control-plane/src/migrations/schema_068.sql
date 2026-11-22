-- Second review of the deletion runner.
-- `marker_required_since`: the moment this migration introduced the tenant marker requirement. A tenant created before it may have been provisioned without
-- `liwan.control.tenant_id` and may be stamped once by the deletion runner; a tenant created after it with no marker is a refusal that needs an operator.
ALTER TABLE control_plane_state ADD COLUMN marker_required_since timestamptz;
UPDATE control_plane_state SET marker_required_since = now() WHERE singleton = true;

-- Money that reached the bank before the deletion started must still be recordable. Only the operator's bank-transfer recording (`confirmBankTransfer`) sets
-- the transaction-local flag below; no customer route runs that function, and the row must be a bank-transfer attempt of the bank-transfer provider.
CREATE OR REPLACE FUNCTION payment_attempt_retiring_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'bank_transfer' AND NEW.provider = 'bank_transfer' AND current_setting('liwan.bank_transfer_recording', true) = 'on' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM orders o JOIN tenant_deletion_requests r ON r.customer_id = o.customer_id WHERE o.id = NEW.order_id AND r.state IN ('deleting','deleted')) THEN
    RAISE EXCEPTION 'tenant_retiring' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;

-- Removes the named keys at every depth of a JSON document (objects and arrays), for the final scrub of recipients, codes and addresses.
CREATE FUNCTION jsonb_strip_keys(doc jsonb, keys text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE jsonb_typeof(doc)
    WHEN 'object' THEN COALESCE((SELECT jsonb_object_agg(e.k, jsonb_strip_keys(e.v, keys)) FROM jsonb_each(doc) AS e(k, v) WHERE e.k <> ALL(keys)), '{}'::jsonb)
    WHEN 'array' THEN COALESCE((SELECT jsonb_agg(jsonb_strip_keys(a.v, keys) ORDER BY a.ord) FROM jsonb_array_elements(doc) WITH ORDINALITY AS a(v, ord)), '[]'::jsonb)
    ELSE doc END
$$;
