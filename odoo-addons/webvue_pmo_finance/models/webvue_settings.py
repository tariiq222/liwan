# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .project_project import FINANCE_FEATURE


class WebVuePmoSettings(models.AbstractModel):
    _inherit = 'webvue.pmo.settings'

    @api.model
    def _webvue_settings_extensions(self):
        specs = super()._webvue_settings_extensions()
        if not self.env['webvue.entitlement.service']._webvue_feature_read(FINANCE_FEATURE):
            return specs
        return [*specs, {
            'name': 'webvue_pmo_finance_cost_center_mode',
            'kind': 'selection',
            'label': self.env._("Cost centers of projects"),
            'help': self.env._(
                "Automatic creates a cost center for every new project, whose posted expense becomes the project's "
                "actual cost. Manual leaves each project to choose its own.",
            ),
        }]
