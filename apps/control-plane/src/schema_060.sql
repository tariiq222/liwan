-- The provider's webhook registration codes are audit events (action 'payment.webhook_verification'); looking one up by webhook and code,
-- counting the unsigned ones of the last hour, and the vendor alert scan all read only those few rows. A partial index on that one action
-- keeps those reads from scanning the whole audit log, and needs no table of its own: the audit event is already the durable fact.
CREATE INDEX audit_events_webhook_verification ON audit_events (created_at) WHERE action = 'payment.webhook_verification';
