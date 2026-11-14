# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class OperationsProcess(models.Model):
    _inherit = 'liwan.operation.process'

    @api.model
    def _operations_feature(self, execution_kind):
        return super()._operations_feature(execution_kind) or 'operations.enabled'
