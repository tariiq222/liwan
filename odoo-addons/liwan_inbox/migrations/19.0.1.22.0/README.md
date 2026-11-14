# 19.0.1.22.0

`liwan_inbox` now depends on `liwan_products` (the shared products service) and registers `inbox.enabled` as a feature
that opens `/api/v1/products`. The built-in manager role gains `products.manage` and `products.prices.manage`: the
grants are linked by `_liwan_repair_builtin_role_grants` from the security data on update, and no stored data changes,
so nothing needs a script. The payments bridge migrates its own catalog products (`liwan_inbox_payments` 19.0.1.4.0).
