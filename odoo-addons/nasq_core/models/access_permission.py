# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class NasqAccessPermission(models.Model):
    _name = 'nasq.access.permission'
    _description = 'Nasq Access Permission'
    _order = 'key'

    key = fields.Char(required=True, index=True)
    domain = fields.Selection(
        [('access', 'Access'), ('hr', 'HR'), ('pmo', 'PMO'), ('settings', 'Settings')],
        required=True,
    )
    resource = fields.Char(required=True)
    action = fields.Char(required=True)
    name_ar = fields.Char(required=True)
    name_en = fields.Char()
    description_ar = fields.Char(required=True)
    description_en = fields.Char()
    dependency_ids = fields.Many2many(
        'nasq.access.permission',
        'nasq_access_permission_dependency_rel',
        'permission_id', 'dependency_id',
    )
    group_xmlid = fields.Char(required=True)
    custom_role_allowed = fields.Boolean(default=True, required=True)
    sensitive = fields.Boolean(default=False, required=True)
    project_contextual = fields.Boolean(default=False, required=True)

    _key_unique = models.Constraint('UNIQUE(key)', 'permission key must be unique')

    @api.model
    def _search(
        self, domain, offset=0, limit=None, order=None, *,
        active_test=True, bypass_access=False,
    ):
        if (
            not bypass_access
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
        ):
            self.env['nasq.access.service']._nasq_require_capability(
                'access.roles.read',
            )
        return super()._search(
            domain, offset=offset, limit=limit, order=order,
            active_test=active_test, bypass_access=bypass_access,
        )

    def check_access(self, operation):
        if (
            operation == 'read'
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
        ):
            self.env['nasq.access.service']._nasq_require_capability(
                'access.roles.read',
            )
        return super().check_access(operation)
