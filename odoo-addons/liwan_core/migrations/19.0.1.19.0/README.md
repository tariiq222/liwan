# 19.0.1.19.0 — vendor support is closed by default

A support user's runtime capability keys are now the keys applications grant `liwan_core.role_vendor_support`, not the whole
catalog. `_liwan_repair_builtin_role_grants` (run from `access_migration_post.xml` on every upgrade) now also unlinks
persisted grants of that one role whose key is in the currently loaded catalog but no longer in the composed allowlist (keys of addons not loaded yet during `-u` are left for those addons' own repair call; the last call in graph order sees the full catalog), so the stored role equals what support holds.
No other built-in role loses a grant. The data file performs that repair.

`post-vendor-support-groups.py` also finishes the Odoo group layer: the support group no longer implies `group_customer_admin` (and through it `group_access_admin` and the maintenance manager group), so the script unlinks those groups from the support group and from support users, then rebuilds their capability groups from the keys support now holds. It is idempotent.
