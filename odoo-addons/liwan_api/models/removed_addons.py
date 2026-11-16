# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Addons removed from the source tree whose rows a database installed earlier still holds.

The AI bridges ``liwan_<app>_ai`` are folded into their applications once the AI registries live in liwan_api, and the
HR, documents, customer messages and appointments bridges into their applications. A database installed before keeps the removed addon's module row (left ``to upgrade`` by ``-u``, which Odoo reports as an inconsistent
state) and its ``ir.model.data`` rows. A later removal adds its name here and calls ``forget_removed_addons`` from the end
migration of its version. A removed addon that owned data records (an ACL, a group) first hands their xml ids to the new
owner with ``hand_over_xml_ids``.
"""
from odoo.exceptions import UserError

REMOVED_ADDONS = (
    'liwan_sales_ai', 'liwan_hr_ai', 'liwan_finance_ai', 'liwan_operations_ai', 'liwan_pmo_ai',
    'liwan_crm_ai', 'liwan_tasks_ai', 'liwan_meetings_ai',
    'liwan_access_hr', 'liwan_documents_hr', 'liwan_hr_operations', 'liwan_documents_pmo',
    'liwan_inbox_payments', 'liwan_appointments_payments',
)

# The rows Odoo itself writes for an addon that only extends models (`_inherit`) and ships no data file.
BOOKKEEPING_MODELS = (
    'ir.model', 'ir.model.fields', 'ir.model.fields.selection', 'ir.model.constraint', 'ir.model.relation',
)


def hand_over_xml_ids(env, source, target, names):
    """Give the xml ids ``<source>.<name>`` of ``names`` to the module ``target``; the records they name are kept.

    Run it from a ``pre`` migration that runs before ``target`` loads its data files: those files then update the same
    records instead of creating second ones. Idempotent: a name ``source`` does not hold (already handed over, or never
    installed) is skipped. Refuses when ``target`` already holds one of the names, since two records would then compete."""
    data = env['ir.model.data']
    names = list(names)
    moving = data.search([('module', '=', source), ('name', 'in', names)])
    taken = data.search([('module', '=', target), ('name', 'in', moving.mapped('name'))])
    if taken:
        raise UserError(
            'Cannot hand the xml ids %s of %s to %s: %s already holds them.'
            % (', '.join(sorted(taken.mapped('name'))), source, target, target),
        )
    moving.write({'module': target})
    # The xml id lookup reads the table itself: the data files loaded next must find the new owner.
    moving.flush_recordset(['module'])


def forget_removed_addons(env, names=REMOVED_ADDONS):
    """Forget the modules ``names`` and their xml ids; no record is deleted. Idempotent: an addon this database never
    installed is skipped.

    Only for an addon that owns no data records of its own (no ACL, rule, view, cron or data file). One that does must
    hand its xml ids to the new owner (``hand_over_xml_ids``) before it is forgotten: the call refuses while such an xml
    id is left."""
    names = list(names)
    owned = env['ir.model.data'].search([('module', 'in', names), ('model', 'not in', BOOKKEEPING_MODELS)])
    if owned:
        raise UserError(
            'Cannot forget the removed addons %s: they still own xml ids of %s. Hand them to their new owner first.'
            % (', '.join(sorted(set(owned.mapped('module')))), ', '.join(sorted(set(owned.mapped('model'))))),
        )
    module_ids = ['module_%s' % name for name in names]
    env['ir.model.data'].search(['|', ('module', 'in', names), '&', ('module', '=', 'base'), ('name', 'in', module_ids)]).unlink()
    modules = env['ir.module.module'].search([('name', 'in', names)])
    modules.write({'state': 'uninstalled'})
    modules.unlink()
