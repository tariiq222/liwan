# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .project_project import FINANCE_FEATURE


class LiwanPmoSettings(models.AbstractModel):
    _inherit = 'liwan.pmo.settings'

    @api.model
    def _liwan_settings_extensions(self):
        specs = super()._liwan_settings_extensions()
        if not self.env['liwan.entitlement.service']._liwan_feature_read(FINANCE_FEATURE):
            return specs
        return [*specs, {
            'name': 'liwan_pmo_finance_cost_center_mode',
            'kind': 'selection',
            'label': self.env._("Cost centers of projects"),
            'help': self.env._(
                "Automatic creates a cost center for every new project, whose posted expense becomes the project's "
                "actual cost. Manual leaves each project to choose its own.",
            ),
        }]

    def set_values(self, vals):
        # The mode is read while finance is only retained for reading; writing it needs the feature itself.
        if 'liwan_pmo_finance_cost_center_mode' in vals:
            self.env['liwan.entitlement.service'].require(FINANCE_FEATURE)
        return super().set_values(vals)
