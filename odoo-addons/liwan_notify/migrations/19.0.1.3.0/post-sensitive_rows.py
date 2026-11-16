# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A sensitive contract row no longer uses ``auto_delete``: it keeps its row (and weight) and loses its content after sending.

Rows made by 19.0.1.2.0 carry ``auto_delete`` as their sensitivity mark; move that mark to ``liwan_sensitive``.
The new ``liwan.mail.domain`` table, the provider status columns and the two crons start empty and need no data.
"""
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    env['mail.mail'].search([('liwan_kind', '!=', False), ('auto_delete', '=', True)]).write(
        {'liwan_sensitive': True, 'auto_delete': False},
    )
