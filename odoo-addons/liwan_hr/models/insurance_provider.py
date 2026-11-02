# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError

from odoo.addons.liwan_api.controllers.common import ApiError


class LiwanHrInsuranceProvider(models.Model):
    """One insurer of a company (the company's own value list); archived, never deleted."""

    _name = 'liwan.hr.insurance.provider'
    _description = 'LiwanOS HR insurance provider'
    _liwan_scope = 'company'
    _order = 'name, id'

    company_id = fields.Many2one(
        'res.company', required=True, index=True, ondelete='cascade', default=lambda self: self.env.company,
    )
    name = fields.Char(required=True)
    active = fields.Boolean(default=True)
    revision = fields.Integer(required=True, default=1)
    plan_ids = fields.One2many('liwan.hr.insurance.plan', 'provider_id')

    _name_unique = models.Constraint('UNIQUE(company_id, name)', 'a company has one insurance provider per name')
    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')

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
                raise AccessError(self.env._('insurance providers belong to the current company'))
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser():
            self._liwan_require_manage()
            if any(row.company_id != self.env.company for row in self) or 'company_id' in vals:
                raise AccessError(self.env._('insurance providers belong to the current company'))
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser():
            raise AccessError(self.env._('insurance providers are archived, never deleted'))
        return super().unlink()

    def _liwan_save(self, revision, vals):
        """Write ``vals`` at ``revision`` and bump it; a stale revision is a 409."""
        self.ensure_one()
        self.lock_for_update()
        self.invalidate_recordset()
        if revision != self.revision:
            raise ApiError(409, 'conflict', 'the insurance provider changed; reload before saving')
        self.write({**vals, 'revision': revision + 1})
        return self
