# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """An existing database with Arabic active receives the Arabic country names without a translation reload."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    env['res.country']._liwan_write_arabic_names()
