# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

PROVIDER_MODES = ('platform', 'tenant_key')


class LiwanAiSettings(models.Model):
    """The tenant's AI policy that a run needs before it starts: whose provider runs it.

    One record per tenant database (enablement, provider, limits and privacy are tenant-wide, spec 2026-11-04
    §6.7). The tenant key itself and the run retention live with the AI state in schema ``liwan_ai`` of the
    AI service, never here. ``revision`` refuses a write based on a stale read.
    """
    _name = 'liwan.ai.settings'
    _description = 'LiwanOS AI settings'

    provider_mode = fields.Selection([(mode, mode) for mode in PROVIDER_MODES], required=True, default='platform')
    revision = fields.Integer(required=True, default=1)

    @api.model
    def _liwan_current(self):
        """The tenant's settings record, installed with the defaults by ``data/ai_settings.xml``."""
        return self.env.ref('liwan_ai.ai_settings')
