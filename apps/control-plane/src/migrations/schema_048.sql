-- Every reader of usage_snapshots wants the latest row of a tenant (the downgrade check, the usage view, the analytics
-- list, the trial preview), so the index carries the same order as those queries and `DISTINCT ON` no longer sorts a
-- tenant's whole history. It replaces the index without `id`.
CREATE INDEX usage_snapshots_latest_idx ON usage_snapshots(tenant_id, observed_at DESC, id DESC);
DROP INDEX usage_snapshots_tenant_idx;
