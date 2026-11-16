# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The product catalog and the WhatsApp orders move from the removed addon liwan_inbox_payments into liwan_inbox.

Runs before liwan_inbox loads its models and data files, so the same records and tables are kept and updated:

- the two record rules on the catalog marker that addon removed in its 19.0.1.4.0 are deleted first (a database still
  below that version holds them; their domain names a field that is gone, so any product write would fail until the end
  of the upgrade);
- every data xml id it owns (``HANDED_OVER``: capability groups, access rows, record rules, access permissions, the
  sync cron and the server action under it) passes to liwan_inbox with its name unchanged, so the data files update
  those records; the two access rows it dropped in 19.0.1.4.0 (``STALE_ACCESS``) pass too, and Odoo removes them at
  the end of this update as it would have under the old owner.

Its model and field xml ids (``model_liwan_inbox_catalog``, ``field_...``) stay where they are: liwan_inbox reflects the
same models and fields under its own name while it loads, and liwan_api's ``forget_removed_addons`` then deletes the old
rows. Neither step drops a table or a column: Odoo drops them only when a module is uninstalled, and the removed addon
is forgotten, never uninstalled.
"""
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_api.models.removed_addons import hand_over_xml_ids

SOURCE = 'liwan_inbox_payments'
TARGET = 'liwan_inbox'
STALE_RULES = ('product_template_catalog_manage_rule', 'product_product_catalog_manage_rule')
STALE_ACCESS = ('access_product_template_inbox_catalog', 'access_product_product_inbox_catalog')
HANDED_OVER = (
    'group_cap_inbox_catalog_manage',
    'group_cap_inbox_orders_manage',
    'access_liwan_inbox_catalog_reader',
    'access_liwan_inbox_catalog_manager',
    'access_liwan_inbox_catalog_item_reader',
    'access_liwan_inbox_catalog_item_manager',
    'access_liwan_inbox_order_reader',
    'access_liwan_inbox_order_manager',
    'access_liwan_inbox_order_line_reader',
    'access_liwan_inbox_order_line_manager',
    'access_liwan_inbox_channel_catalog',
    'access_liwan_integration_connection_catalog',
    'access_liwan_integration_secret_catalog',
    'liwan_inbox_catalog_company_rule',
    'liwan_inbox_catalog_item_company_rule',
    'liwan_inbox_order_company_rule',
    'liwan_inbox_order_line_company_rule',
    'permission_inbox_catalog_manage',
    'permission_inbox_orders_manage',
    'ir_cron_inbox_catalog_sync',
    'ir_cron_inbox_catalog_sync_ir_actions_server',
    *STALE_ACCESS,
)


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    for name in STALE_RULES:
        rule = env.ref(f'{SOURCE}.{name}', raise_if_not_found=False)
        if rule:
            rule.unlink()
    hand_over_xml_ids(env, SOURCE, TARGET, HANDED_OVER)
