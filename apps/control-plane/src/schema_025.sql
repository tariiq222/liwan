-- Metered subscription quantities. Users and storage are chosen by the customer, so their
-- minimums and unit prices live on the plan next to the included branch count.
ALTER TABLE plan_revisions
  ADD COLUMN included_users integer NOT NULL DEFAULT 0 CHECK (included_users >= 0),
  ADD COLUMN included_storage_mb integer NOT NULL DEFAULT 0 CHECK (included_storage_mb >= 0),
  ADD COLUMN user_prices jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN storage_prices jsonb NOT NULL DEFAULT '[]'::jsonb;
