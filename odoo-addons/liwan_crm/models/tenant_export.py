# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_api.models.tenant_export_hooks import (
    REASON_LOG,
    REASON_RUNTIME,
    model_dataset,
)

APP = 'crm'
DATASETS = (
    ('crm_leads', 'Leads', 'crm.lead', True),
    ('crm_stages', 'Stages', 'crm.stage', False),
    ('crm_phonecalls', 'Phone calls', 'crm.phonecall', False),
    ('crm_call_outcomes', 'Call outcomes', 'liwan.crm.call.outcome', False),
    ('crm_settings', 'Settings', 'liwan.crm.settings', False),
)


class LiwanCrmTenantExport(models.AbstractModel):
    _inherit = 'liwan.tenant.export.hooks'

    @api.model
    def _liwan_export_datasets(self):
        return [
            *super()._liwan_export_datasets(),
            *(
                model_dataset(self.env, APP, key, title, model, attachments=files)
                for key, title, model, files in DATASETS
            ),
            model_dataset(self.env, APP, 'crm_sources', 'Sources', 'utm.source', fields=('id', 'name', 'active')),
        ]

    @api.model
    def _liwan_export_technical_models(self):
        return {
            **super()._liwan_export_technical_models(),
            'liwan.crm.view.log': REASON_LOG,
            'liwan.crm.rotation': REASON_RUNTIME,
            'liwan.crm.import.batch': REASON_RUNTIME,
            'liwan.crm.import.mapping': REASON_RUNTIME,
        }
