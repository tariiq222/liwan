# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """Recompute the ``From`` filter of an existing database: the platform domain plus every verified tenant domain."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    env['liwan.mail.domain']._liwan_write_from_filter()
