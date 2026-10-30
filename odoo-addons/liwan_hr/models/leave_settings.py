# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import api, fields, models
from odoo.exceptions import AccessError

from odoo.addons.liwan_api.controllers.common import ApiError

CANCELLATION_POLICIES = ('manager_approval', 'direct_employee', 'manager_only')


class LiwanHrLeaveSettings(models.Model):
    _name = 'liwan.hr.leave.settings'
    _description = 'LiwanOS leave cancellation policy'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    cancellation_policy = fields.Selection([
        ('manager_approval', 'Manager approval'), ('direct_employee', 'Direct employee cancellation'),
        ('manager_only', 'Manager only'),
    ], required=True, default='manager_approval')
    revision = fields.Integer(required=True, default=1)
    _company_unique = models.Constraint('UNIQUE(company_id)', 'A company has one leave policy.')
    _revision_positive = models.Constraint('CHECK(revision > 0)', 'A saved revision must be positive.')

    @api.model
    def _liwan_require_config(self):
        self.env['liwan.entitlement.service'].require('hr.enabled')
        if not self.env['liwan.access.service']._liwan_has_capability(self.env.user, 'hr.leave.config', company=self.env.company):
            raise AccessError(self.env._('Leave configuration permission is required.'))

    @api.model
    def _liwan_current(self):
        self._liwan_require_config()
        return self.search([('company_id', '=', self.env.company.id)], limit=1)

    @api.model
    def _liwan_effective_policy(self, company):
        service = self.env['liwan.access.service']
        if not self.env.is_superuser() and (
            company.id not in service._liwan_scoped_company_ids()
            or not any(service._liwan_has_capability(self.env.user, key, company=company)
                       for key in ('hr.leave.read', 'hr.leave.config'))
        ):
            raise AccessError(self.env._('Leave policy read permission in the owning company is required.'))
        row = self.search([('company_id', '=', company.id)], limit=1)
        return row.cancellation_policy if row else 'manager_approval'

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_superuser():
            self._liwan_require_config()
            for vals in vals_list:
                if set(vals) - {'company_id', 'cancellation_policy'} or vals.get('company_id') != self.env.company.id:
                    raise AccessError(self.env._('Use the current company leave settings.'))
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser():
            self._liwan_require_config()
            if set(vals) != {'cancellation_policy', 'revision'} or any(row.company_id != self.env.company for row in self):
                raise AccessError(self.env._('Use a revision checked leave policy update.'))
            if isinstance(vals['revision'], bool) or any(row.revision != vals['revision'] for row in self):
                raise ApiError(409, 'conflict', 'leave settings changed; reload before saving')
            vals = {**vals, 'revision': vals['revision'] + 1}
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser():
            raise AccessError(self.env._('Leave policy cannot be deleted.'))
        return super().unlink()

    @api.model
    def action_save(self, cancellation_policy, revision):
        self._liwan_require_config()
        if cancellation_policy not in CANCELLATION_POLICIES or isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise ApiError(422, 'invalid', 'valid policy and nonnegative revision are required')
        row = self._liwan_current()
        if revision != (row.revision if row else 0):
            raise ApiError(409, 'conflict', 'leave settings changed; reload before saving')
        try:
            with self.env.cr.savepoint():
                if row:
                    row.write({'cancellation_policy': cancellation_policy, 'revision': revision})
                else:
                    row = self.create({'company_id': self.env.company.id, 'cancellation_policy': cancellation_policy})
        except UniqueViolation as error:
            raise ApiError(409, 'conflict', 'leave settings changed; reload before saving') from error
        return row
