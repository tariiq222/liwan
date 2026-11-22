-- Fulfillment outbox retry: a failed enqueue is retried with backoff instead of ending the row.
-- next_attempt_at doubles as the claim lease. Error text stays in payload.error.
ALTER TABLE commercial_outbox
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX commercial_outbox_due ON commercial_outbox(kind, next_attempt_at) WHERE status='pending';
-- Re-queue earlier terminal failures whose order is still waiting to be fulfilled.
UPDATE commercial_outbox b SET status='pending', processed_at=NULL, attempts=0, next_attempt_at=now()
FROM orders o
WHERE b.kind='fulfillment.enqueue' AND b.status='failed' AND b.aggregate_id=o.id::text
  AND o.payment_state IN ('paid','not_required') AND o.fulfillment_state='queued' AND NOT o.cancelled;
