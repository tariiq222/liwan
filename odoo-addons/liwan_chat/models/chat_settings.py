# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

# What deleting a message does: `placeholder` clears its text and files and the conversation keeps a «message deleted»
# row (replies, pins and reading order stay intact); `permanent` removes the message for everyone.
MESSAGE_DELETE_MODES = ('placeholder', 'permanent')
DEFAULTS = {'message_delete_mode': 'placeholder'}


class LiwanChatSettings(models.Model):
    """One company's chat policy."""

    _name = 'liwan.chat.settings'
    _description = 'LiwanOS chat settings'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    revision = fields.Integer(required=True, default=1)
    message_delete_mode = fields.Selection(
        [(value, value) for value in MESSAGE_DELETE_MODES], required=True, default=DEFAULTS['message_delete_mode'],
    )

    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one chat settings record')
    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')

    @api.model
    def _liwan_current(self):
        """The current company's row, or an empty recordset when it was never saved."""
        return self.search([('company_id', '=', self.env.company.id)], limit=1)

    @api.model
    def _liwan_effective(self):
        """Every setting of the current company, exact defaults when no row exists. Never writes."""
        row = self._liwan_current()
        return {name: row[name] for name in DEFAULTS} if row else dict(DEFAULTS)
