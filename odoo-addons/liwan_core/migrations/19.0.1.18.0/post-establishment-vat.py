# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""VAT registration becomes one decision per establishment, stored on the root company.

Before this version every company, branch included, stored its own ``liwan_vat_registered``. From this version the
stored value is the root company's decision, and ``liwan_establishment_vat_registered`` (a stored computed field)
carries it on every company of the establishment.

A branch row that is registered while its root is not cannot be resolved here: the operator has to decide whether the
establishment is registered. Every other branch row is cleared, because the root's value is the one source of truth.
The migration writes through the ORM in one transaction and is idempotent: a rerun finds every branch row already
clear and changes nothing.
"""
from odoo import SUPERUSER_ID, api
from odoo.exceptions import ValidationError

FIELD = 'liwan_vat_registered'
DERIVED = 'liwan_establishment_vat_registered'


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    companies = env['res.company'].with_context(active_test=False).search([])
    stale = env['res.company']
    for branch in companies.filtered('parent_id'):
        if not branch[FIELD]:
            continue
        root = branch.root_id
        if not root[FIELD]:
            raise ValidationError(
                'Cannot upgrade this database: the branch %(branch)r is registered for VAT while its root company '
                '%(root)r is not. VAT registration is one decision for the whole establishment: register %(root)r '
                'for VAT with a valid VAT number, or turn the branch registration off, and run the upgrade again.'
                % {'branch': branch.display_name, 'root': root.display_name},
            )
        stale |= branch
    if stale:
        stale.write({FIELD: False})
    # The derived answer of every company is written from its root, including the rows this run cleared.
    companies.invalidate_recordset([DERIVED])
    companies.flush_model([DERIVED])
