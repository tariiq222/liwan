# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models

from odoo.addons.liwan_ai.models.ai_usage import USAGE_SERVICE_PATH


class LiwanAiIrHttp(models.AbstractModel):
    _inherit = 'ir.http'

    @classmethod
    def _liwan_bearer_routes(cls):
        """The usage recorder's API key reaches the usage report route and nothing else."""
        return super()._liwan_bearer_routes() | {USAGE_SERVICE_PATH}
