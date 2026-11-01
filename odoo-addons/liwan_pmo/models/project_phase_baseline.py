# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The baseline check of the planning -> executing gate, added to the phase registry through ``super()``."""
from odoo import models


class ProjectPhaseBaseline(models.Model):
    _inherit = 'project.project'

    def _liwan_gate_checks(self, target):
        checks = super()._liwan_gate_checks(target)
        if target != 'executing':
            return checks
        mode = self.env['liwan.pmo.settings'].baseline_gate()
        if mode == 'off':
            return checks
        has_baseline = bool(self.env['liwan.project.baseline'].search_count([('project_id', '=', self.id)]))
        # `warning` follows the acknowledge-warnings mechanism of the gate; `required` blocks the move.
        check = {'key': 'baseline_set', 'ok': has_baseline, **({'warning': True} if mode == 'warning' else {})}
        return [*checks, check]
