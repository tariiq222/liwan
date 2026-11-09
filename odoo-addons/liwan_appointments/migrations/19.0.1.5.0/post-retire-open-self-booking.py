# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """The `open` self-booking policy is gone: no route serves a public booking page, so a stored row reads as the one
    policy the product has (issue #550). The selection keeps no other value, so a leftover `open` would read as empty."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    env['liwan.appointment.settings'].search([('self_booking_policy', '!=', 'invite_only')]).write({
        'self_booking_policy': 'invite_only',
    })
