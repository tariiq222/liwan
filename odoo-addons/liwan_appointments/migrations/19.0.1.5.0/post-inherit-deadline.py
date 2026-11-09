# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_appointments.models.appointment_settings import DEFAULTS


def migrate(cr, version):
    """Carry every type's stored deadline to the explicit shape: the company policy, or the type's own value.

    Before 19.0.1.5.0 the deadline was a stored column: a type copied the company setting when it was created, and a
    settings save rewrote every type that still held the old value. It is now resolved on read, from
    `inherits_company_deadline` and `own_deadline_hours`. A type whose stored value equals its company's setting becomes
    an inheriting type, which is the behaviour it already had; any other type keeps its value as its own. The old column
    then goes: the field is no longer stored, and leaving it would keep a second copy of the same fact.
    """
    if not version:
        return
    cr.execute(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'resource_booking_type' AND column_name = 'modifications_deadline'",
    )
    if not cr.fetchone():
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    settings = env['liwan.appointment.settings'].search_read([], ['company_id', 'modification_deadline_hours'])
    policy = {
        row['company_id'][0]: row['modification_deadline_hours']
        for row in settings if row['company_id']
    }
    cr.execute('SELECT id, company_id, modifications_deadline FROM resource_booking_type')
    stored = cr.fetchall()
    booking_types = env['resource.booking.type'].with_context(active_test=False)
    for type_id, company_id, hours in stored:
        company_deadline = policy.get(company_id, DEFAULTS['modification_deadline_hours'])
        if hours is None or hours == company_deadline:
            booking_types.browse(type_id).write({'inherits_company_deadline': True, 'own_deadline_hours': 0})
        else:
            booking_types.browse(type_id).write({'inherits_company_deadline': False, 'own_deadline_hours': hours})
    cr.execute('ALTER TABLE resource_booking_type DROP COLUMN modifications_deadline')
