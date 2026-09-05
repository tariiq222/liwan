# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError

from .res_partner import PARTNER_GRANT_MARKER

USER_CREATE_MARKER = 'nasq_core.access_user_create_depth'
USER_WRITE_MARKER = 'nasq_core.access_user_write'


class NasqResUsers(models.Model):
    _inherit = 'res.users'

    nasq_access_assignment_ids = fields.One2many(
        'nasq.access.assignment', 'user_id', string='Nasq access assignments',
    )
    nasq_access_version = fields.Integer(default=0, required=True, readonly=True)
    nasq_access_managed = fields.Boolean(default=False, required=True, readonly=True)

    def _nasq_mark_access_managed(self):
        if not self.ids:
            return self
        self.env.cr.execute(
            'UPDATE res_users SET nasq_access_managed = TRUE '
            'WHERE id = ANY(%s) AND NOT nasq_access_managed',
            [self.ids],
        )
        self.invalidate_recordset(['nasq_access_managed'])
        self.modified(['nasq_access_managed'])
        return self

    @api.constrains('group_ids')
    def _check_at_least_one_administrator(self):
        if self.env.cr.precommit.data.get(USER_WRITE_MARKER):
            return None
        return super()._check_at_least_one_administrator()

    def _nasq_is_customer_actor(self):
        self.ensure_one()
        return not self.has_group('base.group_system') and bool(
            self.env['nasq.access.service']._nasq_capability_keys(self) & {
                'access.users.grant', 'access.users.assign_roles',
                'access.users.disable', 'access.users.reset_password',
                'hr.employees.archive',
            },
        )

    @api.model_create_multi
    def create(self, vals_list):
        if (
            not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(USER_CREATE_MARKER)
        ):
            msg = 'use_protected_nasq_access_operation:res_users_create'
            raise AccessError(msg)
        return super().create(vals_list)

    def write(self, vals):
        allowed = self.env.cr.precommit.data.get(USER_WRITE_MARKER, {})
        protected_write = (
            bool(self.ids)
            and all(set(vals) <= allowed.get(user_id, set()) for user_id in self.ids)
        )
        self_write = (
            self == self.env.user
            and set(vals) <= self._self_accessible_fields()[1]
        )
        if (
            not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(USER_CREATE_MARKER)
            and not protected_write
            and not self_write
        ):
            fields = ','.join(sorted(vals))
            msg = f'use_protected_nasq_access_operation:res_users_write:{fields}'
            raise AccessError(msg)
        result = super().write(vals)
        self._nasq_bump_record_versions()
        return result

    def unlink(self):
        if (
            not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
        ):
            msg = 'use_protected_nasq_access_operation:res_users_unlink'
            raise AccessError(msg)
        return super().unlink()

    @api.model
    def _nasq_access_create(self, vals, capability='access.users.grant'):
        if not self.env.is_superuser():
            self.env['nasq.access.service']._nasq_require_capability(capability)
        partner_id = vals.get('partner_id')
        marker = self.env.cr.precommit.data
        previous = marker.get(PARTNER_GRANT_MARKER)
        marker[USER_CREATE_MARKER] = marker.get(USER_CREATE_MARKER, 0) + 1
        marker[PARTNER_GRANT_MARKER] = {partner_id} if partner_id else set()
        try:
            return super().create(vals)
        finally:
            marker[USER_CREATE_MARKER] -= 1
            if not marker[USER_CREATE_MARKER]:
                marker.pop(USER_CREATE_MARKER, None)
            if previous is None:
                marker.pop(PARTNER_GRANT_MARKER, None)
            else:
                marker[PARTNER_GRANT_MARKER] = previous

    def _nasq_access_write(self, vals, capability):
        if not self.env.is_superuser():
            self.env['nasq.access.service']._nasq_require_capability(capability)
            self.env['nasq.access.service']._nasq_assert_user_scope(self)
        marker = self.env.cr.precommit.data
        previous = marker.get(USER_WRITE_MARKER)
        allowed = dict(previous or {})
        internal_fields = set(vals) | {'group_ids'}
        for user_id in self.ids:
            allowed[user_id] = allowed.get(user_id, set()) | internal_fields
        marker[USER_WRITE_MARKER] = allowed
        try:
            result = super().write(vals)
        finally:
            if previous is None:
                marker.pop(USER_WRITE_MARKER, None)
            else:
                marker[USER_WRITE_MARKER] = previous
        self._nasq_bump_record_versions()
        return result

    def _notify_security_setting_update(self, subject, content, mail_values=None, **kwargs):
        marker = self.env.cr.precommit.data.get(USER_WRITE_MARKER, {})
        protected_password_change = self.ids and all(
            'password' in marker.get(user_id, set()) for user_id in self.ids
        )
        if protected_password_change:
            # Stock mail falls back to reading base.user_root when neither the
            # company nor the acting administrator has a sender address. That
            # cross-company read must stay denied. Nasq administrator resets
            # are instead recorded in the immutable access audit and revoke
            # existing sessions; self-service changes retain the stock alert.
            return self.env['mail.mail']
        return super()._notify_security_setting_update(
            subject, content, mail_values=mail_values, **kwargs,
        )

    def _nasq_bump_record_versions(self):
        if self.ids:
            self.env.cr.execute(
                'UPDATE res_users SET nasq_access_version = COALESCE(nasq_access_version, 0) + 1 WHERE id = ANY(%s)',
                [self.ids],
            )
            self.invalidate_recordset(['nasq_access_version'])
            self.modified(['nasq_access_version'])

    def _nasq_sync_capability_groups(self):
        Permission = self.env['nasq.access.permission']
        service = self.env['nasq.access.service']
        all_permission_groups = self.env['res.groups']
        by_key = {}
        for permission in Permission.search([]):
            group = self.env.ref(permission.group_xmlid, raise_if_not_found=False)
            if group:
                all_permission_groups |= group
                by_key[permission.key] = group
        for user in self:
            desired = self.env['res.groups']
            capability_keys = set()
            self.env.cr.execute(
                'SELECT cid FROM res_company_users_rel WHERE user_id = %s',
                [user.id],
            )
            company_ids = [company_id for company_id, in self.env.cr.fetchall()]
            for company in self.env['res.company'].browse(company_ids):
                capability_keys |= service._nasq_capability_keys(
                    user, company=company,
                )
            for key in capability_keys:
                desired |= by_key.get(key, self.env['res.groups'])
            explicit = user.group_ids - all_permission_groups
            user._nasq_access_write(
                {'group_ids': [(6, 0, (explicit | desired).ids)]},
                'access.users.assign_roles',
            )
        return True
