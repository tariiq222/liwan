# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

from .insurance_enrollment import WRITE_CONTEXT, WRITE_TOKEN, _text
from odoo.addons.liwan_api.controllers.common import ApiError

RELATIONS = ('spouse', 'child', 'parent', 'other')
NATIONAL_ID_PATTERN = re.compile(r'^[0-9A-Za-z-]{5,20}$')
NAME_LIMIT = 100


def mask_national_id(value):
    """The id as ``******1234``: only the last four characters, for lists and for readers who may not see it all."""
    return f'{"*" * 6}{value[-4:]}' if value else None


class LiwanHrInsuranceDependent(models.Model):
    """A family member covered through an employee's enrollment, over a date range inside it."""

    _name = 'liwan.hr.insurance.dependent'
    _description = 'LiwanOS HR insurance dependent'
    _liwan_scope = 'company'
    _order = 'date_from, id'

    enrollment_id = fields.Many2one('liwan.hr.insurance.enrollment', required=True, ondelete='restrict', index=True)
    company_id = fields.Many2one(related='enrollment_id.company_id', store=True, index=True)
    employee_user_id = fields.Many2one(related='enrollment_id.employee_user_id', store=True, index=True)
    name = fields.Char(required=True)
    relation = fields.Selection([(key, key.title()) for key in RELATIONS], required=True)
    birth_date = fields.Date()
    national_id = fields.Char()
    date_from = fields.Date(required=True)
    date_to = fields.Date()
    state = fields.Selection([('active', 'Active'), ('ended', 'Ended')], required=True, default='active', index=True)
    revision = fields.Integer(required=True, default=1)

    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')

    @api.constrains('enrollment_id', 'date_from', 'date_to')
    def _check_dates(self):
        for row in self.filtered(lambda item: item.enrollment_id.state != 'cancelled'):
            enrollment = row.enrollment_id
            end = row.date_to or enrollment.date_end_effective
            if row.date_to and row.date_to < row.date_from:
                raise ValidationError(self.env._('The coverage cannot end before it starts.'))
            if row.date_from < enrollment.date_from or end > enrollment.date_end_effective:
                raise ValidationError(self.env._('The dependent dates must lie inside the enrollment.'))
            if row.birth_date and row.birth_date > fields.Date.context_today(self):
                raise ValidationError(self.env._('The birth date cannot be in the future.'))

    @api.constrains('national_id')
    def _check_national_id(self):
        for row in self:
            if row.national_id and not NATIONAL_ID_PATTERN.match(row.national_id):
                raise ValidationError(self.env._('The identity number is not valid.'))

    # --- the write gate ----------------------------------------------------------------------------------

    def _liwan_open(self):
        return self.env.is_superuser() or self.env.context.get(WRITE_CONTEXT) is WRITE_TOKEN

    @api.model_create_multi
    def create(self, vals_list):
        if not self._liwan_open():
            raise AccessError(self.env._('Dependents are added through the insurance actions.'))
        return super().create(vals_list)

    def write(self, vals):
        if not self._liwan_open():
            raise AccessError(self.env._('A dependent is changed only through the insurance actions.'))
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser():
            raise AccessError(self.env._('Dependents are ended, never deleted.'))
        return super().unlink()

    # --- the lifecycle -------------------------------------------------------------------------------------

    def _liwan_log(self, action, before=None):
        return self.env['liwan.hr.audit.event']._liwan_log(action, self, before=before)

    def _liwan_audit_authorized(self, action):
        self.ensure_one()
        return self.env['liwan.hr.insurance.enrollment']._liwan_can_manage(self.company_id)

    def _liwan_load(self, revision):
        self.ensure_one()
        self.lock_for_update()
        self.invalidate_recordset()
        if isinstance(revision, bool) or not isinstance(revision, int) or revision != self.revision:
            raise ApiError(409, 'conflict', 'the dependent changed; reload before saving')

    def _liwan_step(self, vals):
        self.with_context(**{WRITE_CONTEXT: WRITE_TOKEN}).write({**vals, 'revision': self.revision + 1})

    @api.model
    def _liwan_clean(self, vals, company, creating=False):
        """The text fields of a payload, checked against the company's policy (an identity number it requires)."""
        cleaned = dict(vals)
        if 'name' in vals:
            cleaned['name'] = _text(self.env, vals['name'], 'name', NAME_LIMIT)
            if not cleaned['name']:
                raise ApiError(422, 'invalid', 'name must not be empty', field='name')
        if 'national_id' in vals:
            cleaned['national_id'] = _text(self.env, vals['national_id'], 'national_id', 20)
        policy = self.env['liwan.hr.insurance.settings']._liwan_effective(company)
        if policy['insurance_require_dependent_id'] and (creating or 'national_id' in cleaned) and not cleaned.get('national_id'):
            raise ApiError(422, 'invalid', 'national_id is required by the company policy', field='national_id')
        return cleaned

    @api.model
    def action_add(self, enrollment, vals):
        """Add a dependent to an active enrollment."""
        if not self.env['liwan.hr.insurance.enrollment']._liwan_can_manage(enrollment.company_id):
            raise AccessError(self.env._('forbidden'))
        enrollment._liwan_expect_active()
        cleaned = self._liwan_clean(vals, enrollment.company_id, creating=True)
        row = self.with_context(**{WRITE_CONTEXT: WRITE_TOKEN}).create({
            'enrollment_id': enrollment.id,
            'name': cleaned['name'],
            'relation': cleaned['relation'],
            'birth_date': cleaned.get('birth_date') or False,
            'national_id': cleaned.get('national_id') or False,
            'date_from': cleaned['date_from'],
            'date_to': cleaned.get('date_to') or False,
        })
        row._liwan_log('dependent_added')
        return row

    def action_update(self, revision, vals):
        """Change the details or the dates of an active dependent."""
        self._liwan_load(revision)
        if self.state != 'active':
            raise ApiError(409, 'conflict', 'the dependent coverage has ended; this step is not available')
        if not self._liwan_audit_authorized('dependent_changed'):
            raise AccessError(self.env._('forbidden'))
        self.enrollment_id._liwan_expect_active()
        cleaned = self._liwan_clean(vals, self.company_id)
        before = self.env['liwan.hr.audit.event']._liwan_policy_snapshot(self)
        self._liwan_step(cleaned)
        self._liwan_log('dependent_changed', before)
        return self

    def action_end(self, revision, date_end):
        """End one dependent's coverage on ``date_end`` (today when omitted)."""
        self._liwan_load(revision)
        if self.state != 'active':
            raise ApiError(409, 'conflict', 'the dependent coverage has ended; this step is not available')
        if not self._liwan_audit_authorized('dependent_ended'):
            raise AccessError(self.env._('forbidden'))
        date_end = date_end or fields.Date.context_today(self)
        if date_end < self.date_from or date_end > self.enrollment_id.date_end_effective:
            raise ValidationError(self.env._('The end date must lie between the start date and the end of the enrollment.'))
        before = self.env['liwan.hr.audit.event']._liwan_policy_snapshot(self)
        self._liwan_step({'state': 'ended', 'date_to': date_end})
        self._liwan_log('dependent_ended', before)
        return self

    def _liwan_end_with(self, date_end):
        """End the still active dependents together with their enrollment (audited with it, not one by one)."""
        for row in self.filtered(lambda item: item.state == 'active'):
            end = max(min(row.date_to or date_end, date_end), row.date_from)
            row._liwan_step({'state': 'ended', 'date_to': end})
