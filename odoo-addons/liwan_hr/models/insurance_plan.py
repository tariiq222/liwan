# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Domain

from .notification_types import INSURANCE_KIND
from odoo.addons.liwan_api.controllers.common import ApiError

_logger = logging.getLogger(__name__)

PLAN_STATES = ('active', 'expired', 'archived')


class LiwanHrInsurancePlan(models.Model):
    """One policy of a provider that employees are enrolled in, valid between two dates."""

    _name = 'liwan.hr.insurance.plan'
    _description = 'LiwanOS HR insurance plan'
    _liwan_scope = 'company'
    _order = 'valid_to desc, id desc'

    company_id = fields.Many2one(
        'res.company', required=True, index=True, ondelete='cascade', default=lambda self: self.env.company,
    )
    currency_id = fields.Many2one(related='company_id.currency_id')
    provider_id = fields.Many2one('liwan.hr.insurance.provider', required=True, ondelete='restrict', index=True)
    name = fields.Char(required=True)
    # The class or tier label the insurer sells the plan under (Gold, VIP, ...); free text, the tenant's own wording.
    tier = fields.Char()
    policy_number = fields.Char()
    valid_from = fields.Date(required=True)
    valid_to = fields.Date(required=True)
    annual_premium = fields.Monetary(currency_field='currency_id')
    active = fields.Boolean(default=True)
    revision = fields.Integer(required=True, default=1)
    enrollment_ids = fields.One2many('liwan.hr.insurance.enrollment', 'plan_id')
    state = fields.Selection([(key, key.title()) for key in PLAN_STATES], compute='_compute_state')
    expires_in_days = fields.Integer(compute='_compute_state')

    _dates_ordered = models.Constraint('CHECK(valid_to >= valid_from)', 'a plan cannot end before it starts')
    _premium_positive = models.Constraint(
        'CHECK(annual_premium IS NULL OR annual_premium >= 0)', 'the annual premium cannot be negative',
    )
    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')

    @api.depends('active', 'valid_to')
    @api.depends_context('tz')
    def _compute_state(self):
        today = fields.Date.context_today(self)
        for plan in self:
            plan.expires_in_days = (plan.valid_to - today).days if plan.valid_to else 0
            if not plan.active:
                plan.state = 'archived'
            else:
                plan.state = 'expired' if plan.valid_to and plan.valid_to < today else 'active'

    @api.model
    def _liwan_state_domain(self, state):
        """The domain of one derived state; an archived plan needs ``active_test=False`` to be found."""
        today = fields.Date.context_today(self)
        if state == 'archived':
            return Domain('active', '=', False)
        return Domain('active', '=', True) & (
            Domain('valid_to', '<', today) if state == 'expired' else Domain('valid_to', '>=', today)
        )

    @api.constrains('provider_id', 'company_id')
    def _check_provider_company(self):
        for plan in self:
            if plan.provider_id.company_id != plan.company_id:
                raise ValidationError(self.env._('The insurance provider belongs to another company.'))

    @api.constrains('valid_from', 'valid_to')
    def _check_enrollments_inside(self):
        for plan in self:
            for enrollment in plan.enrollment_ids.filtered(lambda row: row.state != 'cancelled'):
                if enrollment.date_from < plan.valid_from or enrollment.date_end_effective > plan.valid_to:
                    raise ValidationError(self.env._('The plan dates must keep every enrollment inside them.'))
                # A longer plan stretches its open-ended enrollments: they must not now overlap another one.
                enrollment._liwan_assert_no_overlap()
                # An open-ended enrollment now ends with the plan: a dependent must not start after that or outlast it.
                for dependent in enrollment.dependent_ids.filtered(lambda item: item.state != 'cancelled'):
                    if dependent.date_from > enrollment.date_end_effective or (
                        dependent.date_to and dependent.date_to > enrollment.date_end_effective
                    ):
                        raise ValidationError(self.env._(
                            'A dependent would be covered beyond the new plan end; end or shorten the dependent first.',
                        ))

    @api.model
    def _liwan_require_manage(self):
        if not self.env.is_superuser() and not self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, 'hr.insurance.manage', company=self.env.company,
        ):
            raise AccessError(self.env._('forbidden'))

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_superuser():
            self._liwan_require_manage()
            if any(vals.get('company_id', self.env.company.id) != self.env.company.id for vals in vals_list):
                raise AccessError(self.env._('insurance plans belong to the current company'))
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser():
            self._liwan_require_manage()
            if any(row.company_id != self.env.company for row in self) or {'company_id', 'provider_id'} & set(vals):
                raise AccessError(self.env._('insurance plans belong to the current company'))
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser():
            raise AccessError(self.env._('insurance plans are archived, never deleted'))
        return super().unlink()

    def _liwan_save(self, revision, vals):
        """Write ``vals`` at ``revision`` and bump it; a stale revision is a 409."""
        self.ensure_one()
        self.lock_for_update()
        self.invalidate_recordset()
        if revision != self.revision:
            raise ApiError(409, 'conflict', 'the insurance plan changed; reload before saving')
        # New dates move the end of every open-ended enrollment: serialize with the requests enrolling those employees.
        self.env['liwan.hr.insurance.enrollment']._liwan_lock_employees(
            self.enrollment_ids.filtered(lambda row: row.state != 'cancelled').employee_id,
        )
        self.write({**vals, 'revision': revision + 1})
        return self

    # --- expiry alerts --------------------------------------------------------------------------------------

    @api.model
    def _liwan_alert_recipients(self, company):
        """The users who manage insurance in ``company``."""
        service = self.env['liwan.access.service']
        candidates = self.env['res.users'].search([('company_ids', 'in', company.id), ('share', '=', False)])
        return candidates.filtered(lambda user: service._liwan_has_capability(user, 'hr.insurance.manage', company=company))

    @api.model
    def _liwan_run_expiry_alerts(self):
        """Tell each company's insurance managers about plans that end within the company's alert window.

        Runs as the cron superuser, company by company. The bell row names the plan only (never a member), and its
        key carries the end date, so a plan alerts once per validity and again after it is renewed. A failing
        company is rolled back and logged; the others still run.
        """
        today = fields.Date.context_today(self)
        for company in self.env['res.company'].search([]):
            try:
                with self.env.cr.savepoint():
                    self.with_company(company)._liwan_alert_company(company, today)
            except Exception:
                _logger.exception('liwan_hr insurance expiry alerts failed for company %s', company.id)

    @api.model
    def _liwan_alert_company(self, company, today):
        days = self.env['liwan.hr.insurance.settings']._liwan_effective(company)['insurance_expiry_alert_days']
        plans = self.search([
            ('company_id', '=', company.id), ('active', '=', True),
            ('valid_to', '>=', today), ('valid_to', '<=', today + timedelta(days=days)),
        ])
        # A plan nobody is covered by needs no manager's attention.
        Enrollment = self.env['liwan.hr.insurance.enrollment']
        plans = plans.filtered(lambda plan: Enrollment.search_count([
            ('plan_id', '=', plan.id), ('state', '=', 'active'), ('date_end_effective', '>=', today),
        ], limit=1))
        if not plans:
            return
        partners = self._liwan_alert_recipients(company).partner_id
        service = self.env['liwan.notify.service']
        for plan in plans:
            for partner in partners:
                service._liwan_deliver(
                    self._name, plan.id, INSURANCE_KIND, partner,
                    self.env._('An insurance plan is about to expire'),
                    key=f'{INSURANCE_KIND}:{plan.id}:{plan.valid_to}:{partner.id}',
                    values={'subject': plan.name},
                )
