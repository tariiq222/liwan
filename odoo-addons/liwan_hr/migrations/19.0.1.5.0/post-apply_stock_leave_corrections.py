# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Apply the leave corrections that the XML data cannot apply on upgrade.

The stock records this version touches belong to hr_holidays and are noupdate, so
``-u liwan_hr`` skips them: only a fresh install writes them. This script repeats
both corrections through the ORM so an existing development database matches a new
one. It is idempotent and changes nothing that is already correct.
"""
from odoo import SUPERUSER_ID, api

# (xmlid, requires_allocation, work entry type xmlid or None)
SAUDI_EVENT_LEAVES = (
    ('hr_holidays.l10n_sa_leave_type_sick_leave_0', False, None),
    ('hr_holidays.l10n_sa_leave_type_maternity', False, None),
    ('hr_holidays.l10n_sa_leave_type_emergency', False, None),
    ('hr_holidays.l10n_sa_leave_type_marriage', False, 'hr_work_entry.work_entry_type_leave'),
    ('hr_holidays.l10n_sa_leave_type_iddah', False, 'hr_work_entry.work_entry_type_leave'),
    ('hr_holidays.l10n_sa_leave_type_hajj', False, 'hr_work_entry.work_entry_type_leave'),
    ('hr_holidays.l10n_sa_leave_type_paternity', False, 'hr_work_entry.work_entry_type_leave'),
    ('hr_holidays.l10n_sa_leave_type_study', False, 'hr_work_entry.work_entry_type_leave'),
)
OFFICER_GROUP = 'hr_holidays.group_hr_holidays_user'
OFFICER_KEEPS = 'hr_holidays.group_hr_holidays_responsible'
DROPPED_IMPLICATION = 'hr.group_hr_user'


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    for xmlid, requires_allocation, work_entry_xmlid in SAUDI_EVENT_LEAVES:
        leave_type = env.ref(xmlid, raise_if_not_found=False)
        if not leave_type:
            raise ValueError(f'liwan_hr: {xmlid} is missing; hr_holidays must be installed')
        vals = {}
        if leave_type.requires_allocation != requires_allocation:
            vals['requires_allocation'] = requires_allocation
        if work_entry_xmlid and not leave_type.work_entry_type_id:
            vals['work_entry_type_id'] = env.ref(work_entry_xmlid).id
        if vals:
            leave_type.write(vals)
    group = env.ref(OFFICER_GROUP)
    responsible = env.ref(OFFICER_KEEPS)
    dropped = env.ref(DROPPED_IMPLICATION, raise_if_not_found=False)
    implied = group.implied_ids
    if dropped and dropped in implied:
        group.write({'implied_ids': [(6, 0, (implied - dropped | responsible).ids)]})
