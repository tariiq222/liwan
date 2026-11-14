# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class LiwanIntegrationSecret(models.Model):
    """One encrypted secret of a connection (a token, an app secret, a webhook handshake token).

    ``value_enc`` is ciphertext of ``liwan_core.models.secret_box`` under the purpose ``liwan_integrations``.
    Only ``integrations.manage`` holds an ACL row here; a consuming addon grants its own capability groups
    read access with its own ACL rows. A value never leaves the server in an answer.
    """
    _name = 'liwan.integration.secret'
    _description = 'LiwanOS integration secret'
    _liwan_scope = 'company'
    _order = 'connection_id, name'

    connection_id = fields.Many2one('liwan.integration.connection', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='connection_id.company_id', store=True, index=True)
    name = fields.Char(required=True)
    value_enc = fields.Char(required=True, copy=False)

    _connection_name_unique = models.Constraint('UNIQUE(connection_id, name)', 'a connection holds one secret per name')
