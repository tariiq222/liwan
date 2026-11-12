# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError


class LiwanAccessAssignment(models.Model):
    _name = 'liwan.access.assignment'
    _description = 'LiwanOS Access Assignment'
    _liwan_scope = 'company'
    _order = 'user_id, role_id, company_id'
    _check_company_auto = True

    user_id = fields.Many2one('res.users', required=True, ondelete='cascade', index=True)
    role_id = fields.Many2one('liwan.access.role', required=True, ondelete='restrict', index=True)
    company_id = fields.Many2one('res.company', required=True, ondelete='cascade', index=True)

    _assignment_unique = models.Constraint(
        'UNIQUE(user_id, role_id, company_id)',
        'role assignment must be unique',
    )

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
            self.env['liwan.access.service']._liwan_require_capability(
                'access.users.read',
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
            self.env['liwan.access.service']._liwan_require_capability(
                'access.users.read',
            )
        return super().check_access(operation)

    @api.constrains('user_id', 'role_id', 'company_id')
    def _check_assignment(self):
        for assignment in self:
            if assignment.company_id not in assignment.user_id.company_ids:
                msg = 'unsupported_scope'
                raise ValidationError(msg)
            if assignment.role_id.company_id and assignment.role_id.company_id != assignment.company_id:
                msg = 'unsupported_scope'
                raise ValidationError(msg)
            if not assignment.role_id.assignable:
                msg = 'role_not_assignable'
                raise ValidationError(msg)

    @api.model
    def _liwan_check_self_grant(self, grants):
        """GRANTS is ``(user, company, role)`` triples about to exist; refuse the caller's own elevation."""
        service = self.env['liwan.access.service']
        by_target = {}
        for user, company, role in grants:
            if user == self.env.user:
                by_target.setdefault((user, company), self.env['liwan.access.role'])
                by_target[user, company] |= role
        for (user, company), roles in by_target.items():
            before = service._liwan_capability_keys(user, company=company)
            service._liwan_assert_self_grant(
                user, company, before, before | set(roles.permission_ids.mapped('key')), roles.mapped('key'),
            )

    @api.model_create_multi
    def create(self, vals_list):
        if self.env.user._liwan_is_customer_actor():
            msg = 'use_protected_liwan_access_operation'
            raise AccessError(msg)
        return self._liwan_access_create(vals_list)

    @api.model
    def _liwan_access_create(self, vals_list):
        if not self.env.is_superuser():
            self.env['liwan.access.service']._liwan_require_capability('access.users.assign_roles')
        if isinstance(vals_list, dict):
            vals_list = [vals_list]
        self.env['res.users'].browse(
            [vals.get('user_id') for vals in vals_list],
        )._liwan_mark_access_managed()
        roles = self.env['liwan.access.role'].browse([vals.get('role_id') for vals in vals_list])
        if any(not role.active for role in roles):
            msg = 'role_disabled'
            raise ValidationError(msg)
        self._liwan_check_self_grant([
            (self.env['res.users'].browse(vals['user_id']), self.env['res.company'].browse(vals['company_id']),
             self.env['liwan.access.role'].browse(vals['role_id']))
            for vals in vals_list
        ])
        assignments = super().create(vals_list)
        self.env['liwan.access.service']._liwan_clear_branch_cache()
        assignments.mapped('user_id')._liwan_sync_capability_groups()
        self.env['liwan.access.service']._liwan_bump_policy(assignments.mapped('company_id'))
        return assignments

    def write(self, vals):
        if self.env.user._liwan_is_customer_actor():
            msg = 'use_protected_liwan_access_operation'
            raise AccessError(msg)
        return self._liwan_access_write(vals)

    def _liwan_access_write(self, vals):
        if not self.env.is_superuser():
            self.env['liwan.access.service']._liwan_require_capability('access.users.assign_roles')
        old_users = self.mapped('user_id')
        old_companies = self.mapped('company_id')
        if vals.get('role_id'):
            role = self.env['liwan.access.role'].browse(vals['role_id'])
            if not role.active:
                msg = 'role_disabled'
                raise ValidationError(msg)
        if {'user_id', 'company_id', 'role_id'} & set(vals):
            self._liwan_check_self_grant([
                (self.env['res.users'].browse(vals.get('user_id', assignment.user_id.id)),
                 self.env['res.company'].browse(vals.get('company_id', assignment.company_id.id)),
                 self.env['liwan.access.role'].browse(vals.get('role_id', assignment.role_id.id)))
                for assignment in self
            ])
        result = super().write(vals)
        self.env['liwan.access.service']._liwan_clear_branch_cache()
        (old_users | self.mapped('user_id'))._liwan_sync_capability_groups()
        self.env['liwan.access.service']._liwan_bump_policy(old_companies | self.mapped('company_id'))
        return result

    def unlink(self):
        if self.env.user._liwan_is_customer_actor():
            msg = 'use_protected_liwan_access_operation'
            raise AccessError(msg)
        return self._liwan_access_unlink()

    def _liwan_access_unlink(self):
        if not self.env.is_superuser():
            self.env['liwan.access.service']._liwan_require_capability('access.users.assign_roles')
        users = self.mapped('user_id')
        companies = self.mapped('company_id')
        result = super().unlink()
        self.env['liwan.access.service']._liwan_clear_branch_cache()
        users._liwan_sync_capability_groups()
        self.env['liwan.access.service']._liwan_bump_policy(companies)
        return result
