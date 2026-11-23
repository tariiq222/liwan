# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hmac

from odoo import models
from odoo.http import request

from odoo.addons.liwan_ai.models.ai_usage import USAGE_SERVICE_PATH
from odoo.addons.liwan_ai.models.usage_key import usage_bearer


class LiwanAiIrHttp(models.AbstractModel):
    _inherit = 'ir.http'

    @classmethod
    def _liwan_bearer_routes(cls):
        """The usage recorder's derived bearer reaches the usage report route and nothing else."""
        return super()._liwan_bearer_routes() | {USAGE_SERVICE_PATH}

    @classmethod
    def _liwan_bearer_user_id(cls, token):
        """The recorder account, for the bearer derived for this database; nobody else, and nobody when no root is configured."""
        if request.httprequest.path == USAGE_SERVICE_PATH:
            expected = usage_bearer(request.env.cr.dbname)
            if expected and hmac.compare_digest(token.encode(), expected.encode()):
                return request.env['liwan.access.service']._liwan_usage_recorder_id()
        return super()._liwan_bearer_user_id(token)
