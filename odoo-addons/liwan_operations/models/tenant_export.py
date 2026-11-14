# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_api.models.tenant_export_hooks import REASON_LOG, model_dataset

APP = 'operations'
DATASETS = (
    ('operation_processes', 'Processes', 'liwan.operation.process', False),
    ('operation_steps', 'Process steps', 'liwan.operation.process.step', False),
    ('operation_requests', 'Requests', 'liwan.operation.request', True),
)


class LiwanOperationsTenantExport(models.AbstractModel):
    _inherit = 'liwan.tenant.export.hooks'

    @api.model
    def _liwan_export_datasets(self):
        return [
            *super()._liwan_export_datasets(),
            *(
                model_dataset(self.env, APP, key, title, model, attachments=files)
                for key, title, model, files in DATASETS
            ),
        ]

    @api.model
    def _liwan_export_technical_models(self):
        return {**super()._liwan_export_technical_models(), 'liwan.operation.event': REASON_LOG}
