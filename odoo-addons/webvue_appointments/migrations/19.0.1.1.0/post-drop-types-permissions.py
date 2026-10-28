# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api

OLD_KEYS = ('appointments.types.read', 'appointments.types.manage')


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    # The three appointments.* capabilities replace the two types.* ones; role grants cascade.
    env['webvue.access.permission'].search([('key', 'in', OLD_KEYS)]).unlink()
