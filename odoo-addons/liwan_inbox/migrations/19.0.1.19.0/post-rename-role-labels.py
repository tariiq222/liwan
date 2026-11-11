# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Rename the built-in Customer Messages roles to the product's current name.

The role records are `noupdate="1"`, so the new display names in
`data/inbox_access_permissions.xml` reach existing databases only here. The role keys, group xmlids and
capability grants are untouched: only the labels the access screen shows change.
"""
from odoo import SUPERUSER_ID, api

ROLES = {
    'liwan_inbox.role_inbox_agent': ('موظف رسائل العملاء', 'Customer Messages agent'),
    'liwan_inbox.role_inbox_supervisor': ('مشرف رسائل العملاء', 'Customer Messages supervisor'),
    'liwan_inbox.role_inbox_manager': ('مدير رسائل العملاء', 'Customer Messages manager'),
}


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    for xmlid, (name_ar, name_en) in ROLES.items():
        role = env.ref(xmlid, raise_if_not_found=False)
        if not role:
            continue
        role.write({'name_ar': name_ar, 'name_en': name_en, 'description': name_en})
