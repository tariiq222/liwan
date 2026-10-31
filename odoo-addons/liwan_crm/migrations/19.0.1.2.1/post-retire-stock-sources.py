# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """The seed file's function does not run on update (noupdate), so existing databases archive here."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    env['utm.source']._liwan_archive_stock_sources()
