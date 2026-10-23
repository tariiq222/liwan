# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError


class WebVueHrShiftSettings(models.Model):
    """One company's reference for calendar-day schedule summaries; timezones stay on Odoo."""

    _name = 'webvue.hr.shift.settings'
    _description = 'WebVue HR shift settings'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    day_reference = fields.Selection(
        [('company', 'Company timezone'), ('user', 'User timezone')], required=True, default='company',
    )
    revision = fields.Integer(required=True, default=1)
    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one shift settings record')
    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')

    @api.model
    def _webvue_require_current_company(self, *capabilities):
        if not any(self.env['webvue.access.service']._webvue_has_capability(
            self.env.user, capability, company=self.env.company,
        ) for capability in capabilities):
            raise AccessError(self.env._('forbidden'))

    @api.model
    def _webvue_current(self):
        self._webvue_require_current_company('hr.employees.read', 'hr.shifts.manage')
        return self.search([('company_id', '=', self.env.company.id)], limit=1)

    def check_access(self, operation):
        # Odoo search checks this public hook before applying record rules.
        if operation == 'read' and not self.env.is_superuser():
            self._webvue_require_current_company('hr.employees.read', 'hr.shifts.manage')
        return super().check_access(operation)

    def read(self, fields=None, load='_classic_read'):
        if not self.env.is_superuser():
            self._webvue_require_current_company('hr.employees.read', 'hr.shifts.manage')
        return super().read(fields=fields, load=load)

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_superuser():
            self._webvue_require_current_company('hr.shifts.manage')
            if any(vals.get('company_id') != self.env.company.id for vals in vals_list):
                raise AccessError(self.env._('shift settings belong to the current company'))
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser():
            self._webvue_require_current_company('hr.shifts.manage')
            if any(row.company_id != self.env.company for row in self) or (
                'company_id' in vals and vals['company_id'] != self.env.company.id
            ):
                raise AccessError(self.env._('shift settings belong to the current company'))
        return super().write(vals)
