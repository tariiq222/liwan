# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanHrFeatureRegistry(models.AbstractModel):
    _inherit = 'liwan.feature.registry'

    @api.model
    def _liwan_feature_definitions(self):
        return super()._liwan_feature_definitions() + (
            {
                'key': 'hr.enabled',
                'type': 'boolean',
                'owner': 'liwan_hr',
                'module': 'liwan_hr',
            },
            {
                'key': 'hr.recruitment',
                'type': 'boolean',
                'owner': 'liwan_hr',
                'module': 'liwan_hr',
            },
            {
                'key': 'hr.shifts',
                'type': 'boolean',
                'owner': 'liwan_hr',
                'module': 'liwan_hr',
            },
            {
                'key': 'hr.onboarding',
                'type': 'boolean',
                'owner': 'liwan_hr',
                'module': 'liwan_hr',
            },
            {
                'key': 'hr.offboarding',
                'type': 'boolean',
                'owner': 'liwan_hr',
                'module': 'liwan_hr',
            },
            {
                'key': 'hr.assets',
                'type': 'boolean',
                'owner': 'liwan_hr',
                'module': 'liwan_hr',
            },
            {
                'key': 'hr.warnings',
                'type': 'boolean',
                'owner': 'liwan_hr',
                'module': 'liwan_hr',
            },
            {
                'key': 'hr.payroll',
                'type': 'boolean',
                'owner': 'liwan_hr',
                'module': 'liwan_hr',
            },
        )

    @api.model
    def _liwan_module_definitions(self):
        return super()._liwan_module_definitions() + (
            {'id': 'liwan_hr'},
        )
