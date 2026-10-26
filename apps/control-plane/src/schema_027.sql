-- Monotonic commercial-expiry revision per subscription: a late push can never overwrite a newer
-- date (the effect refuses an older revision). The tenant flag records whether the tenant's addon
-- supports the field: NULL unknown (allow the first trial and surface failure), true supported,
-- false explicitly refused.
ALTER TABLE subscriptions ADD COLUMN commercial_expiry_revision integer NOT NULL DEFAULT 0 CHECK (commercial_expiry_revision >= 0);
ALTER TABLE tenants ADD COLUMN commercial_expiry_supported boolean;
