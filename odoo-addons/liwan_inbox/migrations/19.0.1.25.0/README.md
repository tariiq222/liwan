# 19.0.1.25.0

The product catalog and the WhatsApp orders of the removed addon `liwan_inbox_payments` are part of `liwan_inbox`:
the models `liwan.inbox.catalog`, `liwan.inbox.catalog.item`, `liwan.inbox.order` and `liwan.inbox.order.line` keep their
tables and rows, the routes, feature `inbox.catalog` and capabilities `inbox.catalog.manage` and `inbox.orders.manage`
keep their keys. `liwan_inbox` now depends on `liwan_payments` and `sale`.

- `pre-take_over_catalog.py` deletes the two stale catalog-marker record rules (a database below that addon's
  19.0.1.4.0) and gives the data xml ids of `liwan_inbox_payments` to `liwan_inbox` with their names unchanged. The names
  are an explicit list (`HANDED_OVER`), like the HR fold: two capability groups, eleven access rows, four company rules,
  two access permissions, the sync cron and its server action, and the two access rows the addon dropped in 19.0.1.4.0
  (Odoo removes those at the end of this update). Model and field xml ids are reflected again by `liwan_inbox`;
  `liwan_api` 19.0.1.6.0 forgets the old module and its remaining rows. No table or column is dropped.
- The rows of `ir_model_constraint` and `ir_model_relation` are not moved. `liwan_inbox` reflects its constraints and
  many2many tables under its own module while it loads (`_reflect_constraint`, `_reflect_relation` in Odoo's
  `odoo/addons/base/models/ir_model.py:1938,2059`, keyed by name and module). The old module's rows go with its module
  row by the database foreign key (`ondelete='cascade'`, `ir_model.py:1873,2026`) when `forget_removed_addons` deletes it;
  no ORM `unlink` of those rows runs. Odoo drops a constraint only in `ir.model.constraint.unlink` (`ir_model.py:1881`)
  and a many2many table only in `ir.model.relation._module_data_uninstall` (`ir_model.py:2030`), both reached only by
  uninstalling a module, and both skip a name another module still declares (`ir_model.py:1891-1898,2038-2047`).
- The access permissions' `group_xmlid` values follow the groups' new prefix (`liwan_inbox.group_cap_inbox_catalog_manage`,
  `liwan_inbox.group_cap_inbox_orders_manage`) when the data file loads.
- `post-resend_catalog_prices.py` and `end-adopt_catalog_products.py` carry the removed addon's 19.0.1.3.0 and 19.0.1.4.0
  changes for a database that has not run them; each acts only while the column it removes is still there. Its
  19.0.1.1.0 script (vendor support loses the catalog and orders grants) is not carried: the only release that shipped
  the addon (`release/19.0.1.0.5`) already had it at 19.0.1.1.0.

Operator note: on a database that still has `liwan_inbox_payments` installed, update `liwan_inbox` together with or
before `liwan_api` (`-u all`, or `-u liwan_api`, which pulls its dependents). The end script of `liwan_api` refuses to
forget the removed addon while it still owns xml ids, and the `pre` script here is what hands them over.
