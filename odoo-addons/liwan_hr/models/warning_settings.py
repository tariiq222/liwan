# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import api, fields, models
from odoo.exceptions import AccessError

from odoo.addons.liwan_api.controllers.common import ApiError

WARNINGS_ISSUED_BY = ('hr_only', 'manager_and_hr')
EMPLOYEE_ACKNOWLEDGEMENT = ('required', 'optional', 'off')
DEFAULT_ISSUED_BY = 'hr_only'
DEFAULT_ACKNOWLEDGEMENT = 'optional'
DEFAULT_WINDOW_MONTHS = 12
MAX_WINDOW_MONTHS = 60


class LiwanHrWarningSettings(models.Model):
    """One company's warning policy: who may issue, whether the employee answers, how far back warnings escalate."""

    _name = 'liwan.hr.warning.settings'
    _description = 'LiwanOS HR warning settings'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    warnings_issued_by = fields.Selection(
        [('hr_only', 'HR only'), ('manager_and_hr', 'Direct manager and HR')],
        required=True, default=DEFAULT_ISSUED_BY,
    )
    warnings_employee_acknowledgement = fields.Selection(
        [('required', 'Required'), ('optional', 'Optional'), ('off', 'Off')],
        required=True, default=DEFAULT_ACKNOWLEDGEMENT,
    )
    warnings_escalation_window_months = fields.Integer(required=True, default=DEFAULT_WINDOW_MONTHS)
    revision = fields.Integer(required=True, default=1)
    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one warning settings record')
    _window_valid = models.Constraint(
        f'CHECK(warnings_escalation_window_months BETWEEN 1 AND {MAX_WINDOW_MONTHS})',
        'the escalation window must be between 1 and 60 months',
    )
    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')

    @api.model
    def _liwan_require_current_company(self, *capabilities):
        if not any(self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, capability, company=self.env.company,
        ) for capability in capabilities):
            raise AccessError(self.env._('forbidden'))

    @api.model
    def _liwan_current(self):
        self._liwan_require_current_company('hr.employees.read', 'hr.warnings.manage')
        return self.search([('company_id', '=', self.env.company.id)], limit=1)

    @api.model
    def _liwan_effective(self, company):
        """The company's policy as a dict, defaults when it never saved one; read by the warning model itself."""
        row = self.search([('company_id', '=', company.id)], limit=1)
        return {
            'warnings_issued_by': row.warnings_issued_by if row else DEFAULT_ISSUED_BY,
            'warnings_employee_acknowledgement': row.warnings_employee_acknowledgement if row else DEFAULT_ACKNOWLEDGEMENT,
            'warnings_escalation_window_months': (
                row.warnings_escalation_window_months if row else DEFAULT_WINDOW_MONTHS
            ),
        }

    def check_access(self, operation):
        # Odoo search checks this public hook before applying record rules.
        if operation == 'read' and not self.env.is_superuser():
            self._liwan_require_current_company('hr.employees.read', 'hr.warnings.manage')
        return super().check_access(operation)

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_superuser():
            self._liwan_require_current_company('hr.warnings.manage')
            if any(vals.get('company_id') != self.env.company.id for vals in vals_list):
                raise AccessError(self.env._('warning settings belong to the current company'))
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser():
            self._liwan_require_current_company('hr.warnings.manage')
            if any(row.company_id != self.env.company for row in self) or 'company_id' in vals:
                raise AccessError(self.env._('warning settings belong to the current company'))
        return super().write(vals)

    @api.model
    def action_save(self, vals, revision):
        """Create or update the current company's row at ``revision`` (0 = never saved); a stale one is a 409."""
        self._liwan_require_current_company('hr.warnings.manage')
        row = self._liwan_current()
        if revision != (row.revision if row else 0):
            raise ApiError(409, 'conflict', 'warning settings changed; reload before saving')
        try:
            with self.env.cr.savepoint():
                if row:
                    row.write({**vals, 'revision': revision + 1})
                else:
                    row = self.create({**vals, 'company_id': self.env.company.id})
        except UniqueViolation as error:
            raise ApiError(409, 'conflict', 'warning settings changed; reload before saving') from error
        return row
