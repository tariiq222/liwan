# 19.0.1.8.0

No data migration: the bridge `liwan_sales_payments` was folded into `liwan_sales`. The bridge owned no data record, so
nothing is handed over (see the `liwan_sales` migration 19.0.1.2.0). The `end` migration only forgets the removed addon's
module row through `forget_removed_addons` in `liwan_api/models/removed_addons.py`. A database already at 19.0.1.7.0 never
ran this script when it sat in that version, hence the new one.
