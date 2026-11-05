# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import UserError

from odoo.addons.liwan_ai.models import consent_text

REVOCATION_FIELDS = frozenset({'revoked_at', 'revoked_by_id'})


class LiwanAiConsent(models.Model):
    """One signed AI acknowledgement: who signed which text, when, and whether it was revoked.

    The tenant's AI runs, on any provider and any key, exactly while a non-revoked consent of the current text version
    exists (spec 2026-11-04 §6.8). A signed row is a record: only its revocation can be written afterwards.
    """
    _name = 'liwan.ai.consent'
    _description = 'LiwanOS AI acknowledgement'
    # Every run of every employee reads it (the run policy), whichever company they work in.
    _liwan_scope = 'tenant'
    _order = 'signed_at desc, id desc'

    user_id = fields.Many2one('res.users', required=True, ondelete='restrict')
    signed_at = fields.Datetime(required=True)
    text_version = fields.Char(required=True)
    text_hash = fields.Char(required=True)
    revoked_at = fields.Datetime()
    revoked_by_id = fields.Many2one('res.users', ondelete='restrict')

    # One live consent per text version: two concurrent signatures cannot leave a second row behind a revocation.
    _one_live_consent = models.UniqueIndex('(text_version) WHERE revoked_at IS NULL')

    def write(self, vals):
        if set(vals) - REVOCATION_FIELDS:
            raise UserError(self.env._('A signed consent cannot be changed, only revoked.'))
        return super().write(vals)

    @api.model
    def _liwan_valid(self):
        """The non-revoked consent of the current text version, or an empty recordset."""
        return self._liwan_valid_all()[:1]

    @api.model
    def _liwan_valid_all(self):
        return self.search([('text_version', '=', consent_text.CONSENT_VERSION), ('revoked_at', '=', False)])
