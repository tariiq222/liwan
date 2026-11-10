# Part of Odoo. See LICENSE file for full copyright and licensing details.


def migrate(cr, version):
    """The self-booking policy setting is gone (issue #550): it held one value and no route read it. Odoo does not drop
    the column of a removed field, and a leftover required column would reject every new settings row."""
    if not version:
        return
    cr.execute('ALTER TABLE liwan_appointment_settings DROP COLUMN IF EXISTS self_booking_policy')
