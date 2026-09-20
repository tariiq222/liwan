# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError


class NasqTenantProfile(models.Model):
    _name = 'nasq.tenant.profile'
    _description = 'Nasq tenant profile'
    _nasq_scope = 'tenant'

    singleton_key = fields.Char(default='tenant', required=True)
    root_company_id = fields.Many2one(
        'res.company', required=True, ondelete='restrict', index=True,
    )

    _singleton = models.Constraint(
        'UNIQUE(singleton_key)',
        'nasq tenant profile is a singleton',
    )

    @api.model
    def _nasq_xmlid_vals(self, profile):
        return {
            'module': 'nasq_platform',
            'name': 'tenant_profile',
            'model': 'nasq.tenant.profile',
            'res_id': profile.id,
            'noupdate': True,
        }

    @api.model
    def _nasq_ensure_root_company(self):
        existing = self.search([], limit=2)
        if existing:
            if len(existing) != 1:
                raise ValidationError(self.env._(
                    'nasq_platform: multiple tenant profiles exist; refuse to guess.',
                ))
            return existing
        self.env.cr.execute(
            'SELECT id, name FROM res_company WHERE parent_id IS NULL ORDER BY id',
        )
        roots = self.env.cr.fetchall()
        if len(roots) != 1:
            names = ', '.join(f'{row[0]}:{row[1]}' for row in roots) or '(none)'
            raise ValidationError(self.env._(
                'nasq_platform: cannot guess root company; found %(count)s roots (%(names)s). '
                'Set nasq.tenant.profile.root_company_id explicitly.',
                count=len(roots),
                names=names,
            ))
        profile = self.create({
            'singleton_key': 'tenant',
            'root_company_id': roots[0][0],
        })
        if not self.env.ref('nasq_platform.tenant_profile', raise_if_not_found=False):
            self.env['ir.model.data'].create(self._nasq_xmlid_vals(profile))
        return profile

    @api.model_create_multi
    def create(self, vals_list):
        if self.search([], limit=1) or len(vals_list) != 1:
            raise ValidationError(self.env._('nasq tenant profile is a singleton.'))
        return super().create(vals_list)

    def unlink(self):
        raise ValidationError(self.env._('nasq tenant profile cannot be deleted.'))
