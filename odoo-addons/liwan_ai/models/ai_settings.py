# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

PROVIDER_MODES = ('platform', 'tenant_key')
# How the assistant may reach an outside party (a customer's WhatsApp, an email): prepare a draft the employee sends,
# or send after the employee approves (spec 2026-11-04 §6.9).
EXTERNAL_SEND_MODES = ('draft_only', 'approve')
MAX_MESSAGES_PER_USER = 100_000
# The ceiling on the input tokens one request of the assistant may send to a provider (issue #554). It counts every plan
# call of that request, because each call carries the whole prompt and history to the model; a run whose next call would
# start above it stops with `limit_reached` (`input_tokens`). 0 means no cap of the tenant's own.
DEFAULT_INPUT_TOKENS_PER_RUN = 100_000
MAX_INPUT_TOKENS_PER_RUN = 2_000_000
# The largest monthly spend ceiling: the top of the integer column, in cost units (0.00001 USD).
MAX_SPEND_CEILING = 2_147_483_647


class LiwanAiSettings(models.Model):
    """The tenant's AI policy that a run needs before it starts: whose provider runs it.

    One record per tenant database (enablement, provider, limits and privacy are tenant-wide, spec 2026-11-04
    §6.7). The tenant key itself and the run retention live with the AI state in schema ``liwan_ai`` of the
    AI service, never here. ``revision`` refuses a write based on a stale read.
    """
    _name = 'liwan.ai.settings'
    _description = 'LiwanOS AI settings'
    # Every run of every employee reads it (the run policy), whichever company they work in.
    _liwan_scope = 'tenant'

    provider_mode = fields.Selection([(mode, mode) for mode in PROVIDER_MODES], required=True, default='platform')
    # 0 means no cap per user beyond the package's monthly messages.
    messages_per_user_monthly = fields.Integer(required=True, default=0)
    # The tenant's own ceiling on the input tokens of one request (issue #554); 0 means no cap of its own. It applies in
    # both provider modes, because the prompt that grows with the conversation costs the tenant either way.
    input_tokens_per_run = fields.Integer(required=True, default=DEFAULT_INPUT_TOKENS_PER_RUN)
    # The tenant's own ceiling on what the paid assistant may take from the balance in a calendar month, in cost units
    # (spec 2026-11-10 §5.4); 0 means none. Reaching it stops new runs like an empty balance.
    monthly_spend_ceiling = fields.Integer(required=True, default=0)
    external_send = fields.Selection([(mode, mode) for mode in EXTERNAL_SEND_MODES], required=True, default='draft_only')
    # Knowledge retrieval (spec 2026-11-04 §6.3): the indexer reads the declared sources only while this is on.
    knowledge_enabled = fields.Boolean(required=True, default=False)
    revision = fields.Integer(required=True, default=1)

    def write(self, vals):
        switching_off = vals.get('knowledge_enabled') is False and any(self.mapped('knowledge_enabled'))
        result = super().write(vals)
        if switching_off:
            # Turned off: the index and the text still waiting in the queue are dropped, and a later switch-on reads again.
            self.env['liwan.ai.knowledge.indexer']._liwan_rebuild()
        return result

    @api.model
    def _liwan_current(self):
        """The tenant's settings record, installed with the defaults by ``data/ai_settings.xml``."""
        return self.env.ref('liwan_ai.ai_settings')
