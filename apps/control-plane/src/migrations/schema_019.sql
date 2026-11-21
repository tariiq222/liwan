-- Phase 3b: each usage sample carries the gate booleans of every limit key (from the Odoo observation),
-- so the downgrade check decides "application closed" from the same source as the Odoo effect.
ALTER TABLE usage_snapshots ADD COLUMN limit_gates jsonb;
