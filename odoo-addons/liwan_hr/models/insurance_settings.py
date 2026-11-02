# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import api, fields, models
from odoo.exceptions import AccessError

from odoo.addons.liwan_api.controllers.common import ApiError

INSURANCE_VISIBILITY = ('own_enrollment_and_dependents', 'own_enrollment_only')
DEFAULT_VISIBILITY = 'own_enrollment_and_dependents'
DEFAULT_ALERT_DAYS = 60
MAX_ALERT_DAYS = 365
DEFAULT_REQUIRE_DEPENDENT_ID = False


class LiwanHrInsuranceSettings(models.Model):
    """One company's medical insurance policy: what an employee sees, when plan expiry alerts, dependent ids."""

    _name = 'liwan.hr.insurance.settings'
    _description = 'LiwanOS HR insurance settings'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    insurance_visibility = fields.Selection(
        [('own_enrollment_and_dependents', 'Own enrollment and dependents'), ('own_enrollment_only', 'Own enrollment only')],
        required=True, default=DEFAULT_VISIBILITY,
    )
    insurance_expiry_alert_days = fields.Integer(required=True, default=DEFAULT_ALERT_DAYS)
    insurance_require_dependent_id = fields.Boolean(required=True, default=DEFAULT_REQUIRE_DEPENDENT_ID)
    revision = fields.Integer(required=True, default=1)
    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one insurance settings record')
    _alert_days_valid = models.Constraint(
        f'CHECK(insurance_expiry_alert_days BETWEEN 1 AND {MAX_ALERT_DAYS})',
        'the expiry alert window must be between 1 and 365 days',
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
        self._liwan_require_current_company('hr.employees.read', 'hr.insurance.manage')
        return self.search([('company_id', '=', self.env.company.id)], limit=1)

    @api.model
    def _liwan_effective(self, company):
        """The company's policy as a dict, defaults when it never saved one; read by the insurance models themselves."""
        row = self.search([('company_id', '=', company.id)], limit=1)
        return {
            'insurance_visibility': row.insurance_visibility if row else DEFAULT_VISIBILITY,
            'insurance_expiry_alert_days': row.insurance_expiry_alert_days if row else DEFAULT_ALERT_DAYS,
            'insurance_require_dependent_id': (
                row.insurance_require_dependent_id if row else DEFAULT_REQUIRE_DEPENDENT_ID
            ),
        }

    def check_access(self, operation):
        # Odoo search checks this public hook before applying record rules.
        if operation == 'read' and not self.env.is_superuser():
            self._liwan_require_current_company('hr.employees.read', 'hr.insurance.manage')
        return super().check_access(operation)

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_superuser():
            self._liwan_require_current_company('hr.insurance.manage')
            if any(vals.get('company_id') != self.env.company.id for vals in vals_list):
                raise AccessError(self.env._('insurance settings belong to the current company'))
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser():
            self._liwan_require_current_company('hr.insurance.manage')
            if any(row.company_id != self.env.company for row in self) or 'company_id' in vals:
                raise AccessError(self.env._('insurance settings belong to the current company'))
        return super().write(vals)

    @api.model
    def action_save(self, vals, revision):
        """Create or update the current company's row at ``revision`` (0 = never saved); a stale one is a 409."""
        self._liwan_require_current_company('hr.insurance.manage')
        row = self._liwan_current()
        if revision != (row.revision if row else 0):
            raise ApiError(409, 'conflict', 'insurance settings changed; reload before saving')
        try:
            with self.env.cr.savepoint():
                if row:
                    row.write({**vals, 'revision': revision + 1})
                else:
                    row = self.create({**vals, 'company_id': self.env.company.id})
        except UniqueViolation as error:
            raise ApiError(409, 'conflict', 'insurance settings changed; reload before saving') from error
        return row
