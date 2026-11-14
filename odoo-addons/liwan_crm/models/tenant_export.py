# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_api.models.tenant_export_hooks import (
    REASON_LOG,
    REASON_RUNTIME,
    model_dataset,
)

APP = 'crm'
# Settings are an explicit allowlist: a new field is not exported until someone decides it belongs in the export.
SETTINGS_FIELDS = (
    'id',
    'after_attempts',
    'company_id',
    'create_date',
    'discount_allowed',
    'discount_max_percent',
    'distribution_mode',
    'distribution_user_ids',
    'followup_attempts',
    'followup_interval_hours',
    'package_ids',
    'preset',
    'price_above_list',
    'recycle_after_days',
    'recycle_cycles',
    'recycle_enabled',
    'revision',
    'start_stage_id',
    'start_stage_mode',
    'term_customer_gender',
    'term_customer_plural_ar',
    'term_customer_plural_en',
    'term_customer_singular_ar',
    'term_customer_singular_en',
    'term_opportunity_gender',
    'term_opportunity_plural_ar',
    'term_opportunity_plural_en',
    'term_opportunity_singular_ar',
    'term_opportunity_singular_en',
    'term_package_gender',
    'term_package_plural_ar',
    'term_package_plural_en',
    'term_package_singular_ar',
    'term_package_singular_en',
    'view_log_enabled',
    'view_log_retention_months',
    'visibility',
    'write_date',
)
DATASETS = (
    ('crm_leads', 'Leads', 'crm.lead', True),
    ('crm_stages', 'Stages', 'crm.stage', False),
    ('crm_phonecalls', 'Phone calls', 'crm.phonecall', False),
    ('crm_call_outcomes', 'Call outcomes', 'liwan.crm.call.outcome', False),
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
            model_dataset(self.env, APP, 'crm_settings', 'Settings', 'liwan.crm.settings', fields=SETTINGS_FIELDS),
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
