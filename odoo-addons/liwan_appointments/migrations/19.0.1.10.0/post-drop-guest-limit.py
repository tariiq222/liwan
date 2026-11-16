# Part of Odoo. See LICENSE file for full copyright and licensing details.


def migrate(cr, version):
    """The guest read counter moved to the shared ``liwan.api.public.limit`` (``liwan_api``): the model is gone. Odoo
    does not drop the table of a removed model, and a counter is only a minute window, so nothing is carried over."""
    if not version:
        return
    cr.execute('DROP TABLE IF EXISTS liwan_appointment_guest_limit')
