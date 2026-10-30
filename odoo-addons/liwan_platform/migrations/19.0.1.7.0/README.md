Adds `commercial_valid_until_revision` (integer, default 0) to `liwan.tenant.profile`.
Commercial expiry writes then carry a monotonic revision, so a retried older job cannot
overwrite a newer expiry or a later clear. The column is additive; existing rows start at 0.
