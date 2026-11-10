# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanAiFeatureRegistry(models.AbstractModel):
    _inherit = 'liwan.feature.registry'

    @api.model
    def _liwan_feature_definitions(self):
        return super()._liwan_feature_definitions() + (
            {'key': 'ai.enabled', 'type': 'boolean', 'owner': 'liwan_ai', 'module': 'liwan_ai'},
            {'key': 'ai.messages.monthly', 'type': 'limit', 'owner': 'liwan_ai', 'module': 'liwan_ai'},
            {'key': 'ai.tool_calls.per_run', 'type': 'limit', 'owner': 'liwan_ai', 'module': 'liwan_ai'},
            # Retired by the prepaid balance (spec 2026-11-10 §5.4): nothing enforces it. It stays registered only because the
            # control plane still delivers it with the plan revisions pinned for existing tenants, and `_liwan_validate_features`
            # refuses a delivered key with no registered owner. Remove it in the change that stops delivering it.
            {'key': 'ai.tokens.monthly', 'type': 'limit', 'owner': 'liwan_ai', 'module': 'liwan_ai'},
            # The prepaid balance (spec 2026-11-10 §5): the cumulative top-ups, and the free allowance per trial window and per
            # month after the trial, all in cost units. The control plane derives them from its top-up ledger and vendor settings and
            # delivers them with every entitlement; no plan sets them. A customer-hosted installation (`non_saas`) has no balance whatever these hold, and its local policy may omit them.
            {'key': 'ai.balance.granted', 'type': 'limit', 'owner': 'liwan_ai', 'module': 'liwan_ai', 'saas_only': True},
            {'key': 'ai.allowance.trial', 'type': 'limit', 'owner': 'liwan_ai', 'module': 'liwan_ai', 'saas_only': True},
            {'key': 'ai.allowance.monthly', 'type': 'limit', 'owner': 'liwan_ai', 'module': 'liwan_ai', 'saas_only': True},
            {'key': 'ai.output_tokens.per_run', 'type': 'limit', 'owner': 'liwan_ai', 'module': 'liwan_ai'},
            # The free agents' (setup and help) one monthly budget, set by the vendor in the package (spec 2026-11-04 §6.10).
            {'key': 'ai.assist.monthly', 'type': 'limit', 'owner': 'liwan_ai', 'module': 'liwan_ai'},
            # Knowledge retrieval over the company's records (spec 2026-11-04 §6.3); the tenant also turns it on in the settings.
            {'key': 'ai.knowledge', 'type': 'boolean', 'owner': 'liwan_ai', 'module': 'liwan_ai'},
        )

    @api.model
    def _liwan_module_definitions(self):
        return super()._liwan_module_definitions() + ({'id': 'liwan_ai'},)
