# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, fields, models
from odoo.exceptions import ValidationError

# The wire patterns of packages/contracts (access.ts): every application owns its
# keys and its domain, so webvue_core lists none of them and checks only their form.
CAPABILITY_KEY = re.compile(r'[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+')
IDENTIFIER = re.compile(r'[a-z][a-z0-9_]*')


class WebVueAccessPermission(models.Model):
    _name = 'webvue.access.permission'
    _description = 'WebVue Access Permission'
    _webvue_scope = 'tenant'
    _order = 'key'

    key = fields.Char(required=True, index=True)
    # The application area the permission is grouped under in role screens
    # (today access, hr, pmo, meetings, settings; a new application adds its own).
    domain = fields.Char(required=True)
    resource = fields.Char(required=True)
    action = fields.Char(required=True)
    name_ar = fields.Char(required=True)
    name_en = fields.Char()
    description_ar = fields.Char(required=True)
    description_en = fields.Char()
    dependency_ids = fields.Many2many(
        'webvue.access.permission',
        'webvue_access_permission_dependency_rel',
        'permission_id', 'dependency_id',
    )
    group_xmlid = fields.Char(required=True)
    custom_role_allowed = fields.Boolean(default=True, required=True)
    sensitive = fields.Boolean(default=False, required=True)

    _key_unique = models.Constraint('UNIQUE(key)', 'permission key must be unique')

    @api.constrains('key', 'domain')
    def _check_key_and_domain(self):
        for permission in self:
            if not CAPABILITY_KEY.fullmatch(permission.key or ''):
                msg = 'permission_key_invalid'
                raise ValidationError(msg)
            if not IDENTIFIER.fullmatch(permission.domain or ''):
                msg = 'permission_domain_invalid'
                raise ValidationError(msg)

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
            self.env['webvue.access.service']._webvue_require_capability(
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
            self.env['webvue.access.service']._webvue_require_capability(
                'access.roles.read',
            )
        return super().check_access(operation)

    @api.model_create_multi
    def create(self, vals_list):
        result = super().create(vals_list)
        self.env['webvue.access.service']._webvue_clear_branch_cache()
        return result

    def write(self, vals):
        result = super().write(vals)
        self.env['webvue.access.service']._webvue_clear_branch_cache()
        return result

    def unlink(self):
        result = super().unlink()
        self.env['webvue.access.service']._webvue_clear_branch_cache()
        return result
