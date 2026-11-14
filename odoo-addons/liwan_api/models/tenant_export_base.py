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
)

APP = 'base'
USER_FIELDS = ('id', 'login', 'name', 'email', 'active', 'company_id', 'company_ids', 'lang', 'tz', 'create_date', 'login_date')
USERS_SCOPE = 'Only the tenant accounts: not the vendor support accounts and not the public user.'
BRANCH_FIELDS = ('id', 'company_id', 'branch_uid', 'state', 'read_only', 'create_date')
ASSIGNMENT_FIELDS = ('id', 'user_id', 'role_id', 'company_id', 'create_date')
ROLE_FIELDS = (
    'id', 'key', 'name_ar', 'name_en', 'description', 'type', 'active', 'protected', 'assignable', 'company_id',
)


class LiwanTenantExportBase(models.AbstractModel):
    _inherit = 'liwan.tenant.export.hooks'

    @api.model
    def _liwan_export_datasets(self):
        return [
            *super()._liwan_export_datasets(),
            model_dataset(
                self.env, APP, 'companies', 'Companies', 'res.company',
                exclude=('liwan_establishment_vat_registered',),
            ),
            model_dataset(self.env, APP, 'branches', 'Branches', 'liwan.tenant.branch', fields=BRANCH_FIELDS),
            self._liwan_export_users(),
            self._liwan_export_roles(),
            model_dataset(
                self.env, APP, 'role_assignments', 'Role assignments', 'liwan.access.assignment',
                fields=ASSIGNMENT_FIELDS, domain=[('user_id', 'not in', self._liwan_export_hidden_user_ids())], scope=USERS_SCOPE,
            ),
        ]

    @api.model
    def _liwan_export_hidden_user_ids(self):
        """The vendor's support accounts and the public user: never part of the tenant's people."""
        return [*self.env['liwan.entitlement.service']._liwan_excluded_user_ids(), self.env.ref('base.public_user').id]

    @api.model
    def _liwan_export_users(self):
        """The accounts of the tenant: identity and state only (never a hash, session, token or key)."""
        return model_dataset(
            self.env, APP, 'users', 'Users', 'res.users', fields=USER_FIELDS,
            domain=[('id', 'not in', self._liwan_export_hidden_user_ids())], scope=USERS_SCOPE,
        )

    @api.model
    def _liwan_export_roles(self):
        """Roles with the keys of their permissions, so the file says what each role may do."""
        env = self.env

        def rows(after, limit):
            roles = env['liwan.access.role'].with_context(active_test=False).search([('id', '>', after)], order='id', limit=limit)
            out = [[*(cell(role, name) for name in ROLE_FIELDS), ','.join(sorted(role.permission_ids.mapped('key')))] for role in roles]
            return out, (roles[-1].id if roles else after), len(roles) < limit

        return {
            'app': APP, 'key': 'roles', 'title': 'Roles', 'models': ('liwan.access.role',),
            'header': [*ROLE_FIELDS, 'permission_keys'], 'rows': rows, 'files': None, 'filter': None,
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
