# Part of Odoo. See LICENSE file for full copyright and licensing details.
# The bridges liwan_access_hr, liwan_documents_hr and liwan_hr_operations were folded into liwan_hr, liwan_documents_pmo
# into liwan_pmo, liwan_inbox_payments into liwan_inbox and liwan_appointments_payments into liwan_appointments, which
# took over their xml ids in their own migrations: forget the removed addons.
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_api.models.removed_addons import forget_removed_addons


def migrate(cr, version):
    if not version:
        return
    forget_removed_addons(api.Environment(cr, SUPERUSER_ID, {}), names=(
        'liwan_access_hr', 'liwan_documents_hr', 'liwan_hr_operations', 'liwan_documents_pmo',
        'liwan_inbox_payments', 'liwan_appointments_payments',
    ))
