# Part of Odoo. See LICENSE file for full copyright and licensing details.
import uuid

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError


class NasqAccessRole(models.Model):
    _name = 'nasq.access.role'
    _description = 'Nasq Access Role'
    _nasq_scope = 'company'
    _order = 'type, name_ar, id'

    key = fields.Char(required=True, index=True)
    name_ar = fields.Char(required=True)
    name_en = fields.Char()
    description = fields.Text(default='')
    type = fields.Selection(
        [('built_in', 'Built-in'), ('custom', 'Custom')],
        required=True,
        default='custom',
    )
    active = fields.Boolean(default=True, required=True)
    protected = fields.Boolean(default=False, required=True)
    assignable = fields.Boolean(default=True, required=True)
    permission_ids = fields.Many2many(
        'nasq.access.permission',
        'nasq_access_role_permission_rel',
        'role_id', 'permission_id',
    )
    assignment_ids = fields.One2many('nasq.access.assignment', 'role_id')
    company_id = fields.Many2one('res.company', index=True, ondelete='cascade')
    user_count = fields.Integer(compute='_compute_user_count')
    version = fields.Integer(default=0, required=True, readonly=True)

    _key_unique = models.Constraint('UNIQUE(key)', 'role key must be unique')

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

    @api.depends('assignment_ids')
    def _compute_user_count(self):
        for role in self:
            role.user_count = len(role.assignment_ids)

    @api.constrains('name_ar', 'key', 'type', 'permission_ids')
    def _check_definition(self):
        for role in self:
            if not (role.name_ar or '').strip():
                msg = 'invalid_role_name'
                raise ValidationError(msg)
            if role.type != 'custom':
                continue
            if not role.company_id:
                msg = 'custom_role_company_required'
                raise ValidationError(msg)
            forbidden = role.permission_ids.filtered(lambda p: not p.custom_role_allowed)
            if forbidden:
                raise ValidationError(
                    'custom_role_permission_forbidden: %s' % forbidden[0].key,
                )
            selected = set(role.permission_ids.ids)
            for permission in role.permission_ids:
                missing = permission.dependency_ids.filtered(lambda p: p.id not in selected)
                if missing:
                    raise ValidationError(
                        'missing_dependency: %s requires %s' % (permission.key, missing[0].key),
                    )

    @api.model_create_multi
    def create(self, vals_list):
        if self.env.user._nasq_is_customer_actor():
            msg = 'use_protected_nasq_access_operation'
            raise AccessError(msg)
        return self._nasq_access_create(vals_list)

    @api.model
    def _nasq_access_create(self, vals_list):
        if not self.env.is_superuser():
            self.env['nasq.access.service']._nasq_require_capability('access.roles.manage')
        if isinstance(vals_list, dict):
            vals_list = [vals_list]
        for vals in vals_list:
            if vals.get('type', 'custom') == 'custom':
                vals['type'] = 'custom'
                vals['protected'] = False
                vals['assignable'] = True
                vals['company_id'] = self.env.company.id
            if vals.get('type') == 'custom' and not vals.get('key'):
                vals['key'] = 'custom_%s' % uuid.uuid4().hex
        roles = super().create(vals_list)
        self.env['nasq.access.service']._nasq_bump_policy(
            roles.filtered(lambda role: role.type == 'custom').mapped('company_id'),
        )
        return roles

    def write(self, vals):
        if self.env.user._nasq_is_customer_actor():
            msg = 'use_protected_nasq_access_operation'
            raise AccessError(msg)
        if any(role.protected for role in self) and not self.env.user.has_group('base.group_system'):
            msg = 'protected_role'
            raise AccessError(msg)
        return self._nasq_do_write(vals)

    def _nasq_access_write(self, vals):
        if not self.env.is_superuser():
            self.env['nasq.access.service']._nasq_require_capability('access.roles.manage')
        if any(role.protected for role in self):
            msg = 'protected_role'
            raise AccessError(msg)
        if {'type', 'protected', 'assignable', 'key', 'company_id'} & set(vals):
            msg = 'protected_role_fields'
            raise AccessError(msg)
        return self._nasq_do_write(vals)

    def _nasq_do_write(self, vals):
        result = super().write(vals)
        self.env.cr.execute(
            'UPDATE nasq_access_role SET version = COALESCE(version, 0) + 1 WHERE id = ANY(%s)',
            [self.ids],
        )
        self.invalidate_recordset(['version'])
        self.modified(['version'])
        if 'permission_ids' in vals:
            self.assignment_ids.mapped('user_id')._nasq_sync_capability_groups()
        self.env['nasq.access.service']._nasq_bump_policy(
            self.assignment_ids.mapped('company_id') | self.mapped('company_id'),
        )
        return result

    def unlink(self):
        if self.env.user._nasq_is_customer_actor():
            msg = 'use_protected_nasq_access_operation'
            raise AccessError(msg)
        return self._nasq_access_unlink()

    def _nasq_access_unlink(self):
        if not self.env.is_superuser():
            self.env['nasq.access.service']._nasq_require_capability('access.roles.manage')
        if any(role.protected for role in self):
            msg = 'protected_role'
            raise AccessError(msg)
        if any(role.assignment_ids for role in self):
            msg = 'role_in_use'
            raise ValidationError(msg)
        companies = self.mapped('company_id')
        result = super().unlink()
        self.env['nasq.access.service']._nasq_bump_policy(companies)
        return result
