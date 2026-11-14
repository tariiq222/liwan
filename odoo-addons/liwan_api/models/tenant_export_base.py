# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The platform's own datasets of the tenant export: companies and branches, people and roles. Never a password hash,
session, token or API key (the account columns are listed here, not derived)."""
from odoo import api, models

from .tenant_export_hooks import (
    REASON_CREDENTIALS,
    REASON_LOG,
    REASON_RUNTIME,
    cell,
    model_dataset,
    record_batches,
)

APP = 'base'
USER_FIELDS = ('id', 'login', 'name', 'email', 'active', 'company_id', 'company_ids', 'lang', 'tz', 'create_date', 'login_date')
ROLE_FIELDS = (
    'id', 'key', 'name_ar', 'name_en', 'description', 'type', 'active', 'protected', 'assignable', 'company_id',
)


class LiwanTenantExportBase(models.AbstractModel):
    _inherit = 'liwan.tenant.export.hooks'

    @api.model
    def _liwan_export_datasets(self):
        return [
            *super()._liwan_export_datasets(),
            model_dataset(self.env, APP, 'companies', 'Companies', 'res.company'),
            model_dataset(self.env, APP, 'branches', 'Branches', 'liwan.tenant.branch'),
            self._liwan_export_users(),
            self._liwan_export_roles(),
            model_dataset(self.env, APP, 'role_assignments', 'Role assignments', 'liwan.access.assignment'),
        ]

    @api.model
    def _liwan_export_users(self):
        """The accounts of the tenant: identity and state only, and none of the vendor's own support accounts."""
        hidden = [*self.env['liwan.entitlement.service']._liwan_excluded_user_ids(), self.env.ref('base.public_user').id]
        return model_dataset(
            self.env, APP, 'users', 'Users', 'res.users', fields=USER_FIELDS, domain=[('id', 'not in', hidden)],
        )

    @api.model
    def _liwan_export_roles(self):
        """Roles with the keys of their permissions, so the file says what each role may do."""
        env = self.env

        def batches():
            for roles in record_batches(env, 'liwan.access.role', []):
                yield [
                    [*(cell(role, name) for name in ROLE_FIELDS), ','.join(sorted(role.permission_ids.mapped('key')))]
                    for role in roles
                ]

        return {
            'app': APP, 'key': 'roles', 'title': 'Roles', 'models': ('liwan.access.role',),
            'header': [*ROLE_FIELDS, 'permission_keys'], 'batches': batches, 'attachments': None,
        }

    @api.model
    def _liwan_export_technical_models(self):
        return {
            **super()._liwan_export_technical_models(),
            'liwan.account.token': REASON_CREDENTIALS,
            'liwan.login.code': REASON_CREDENTIALS,
            'liwan.login.code.quota': REASON_RUNTIME,
            'liwan.login.code.alert': REASON_LOG,
            'liwan.login.device': REASON_CREDENTIALS,
            'liwan.access.audit': REASON_LOG,
            'liwan.access.permission': REASON_RUNTIME,
            'liwan.access.branch.rule': REASON_RUNTIME,
            'liwan.access.branch.strict': REASON_RUNTIME,
            'liwan.setup.step': REASON_RUNTIME,
            'liwan.tenant.profile': REASON_RUNTIME,
            'liwan.maintenance.authority': REASON_RUNTIME,
            'liwan.maintenance.booking': REASON_RUNTIME,
            'liwan.maintenance.event': REASON_LOG,
            'liwan.maintenance.preference': REASON_RUNTIME,
            'liwan.maintenance.release': REASON_RUNTIME,
            'liwan.tenant.export': REASON_RUNTIME,
            'liwan.tenant.export.log': REASON_LOG,
        }
