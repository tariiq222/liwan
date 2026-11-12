# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import secrets
from contextlib import contextmanager

from psycopg2 import IntegrityError, errorcodes

from odoo import api, fields, models
from odoo.exceptions import AccessError, LockError, ValidationError
from odoo.fields import Command
from odoo.modules import module
from odoo.tools import email_normalize

from .access_permission import IDENTIFIER
from .account_token import RESET_LINKS_PER_HOUR
from .protected_write import marked
from .res_partner import PARTNER_CREATE_MARKER, PARTNER_GRANT_MARKER
from .res_users import MOBILE_PATTERN

MIN_PASSWORD_LENGTH = 12
MOBILE_SEPARATORS = str.maketrans('', '', ' -()')
MOBILE_INDEX = 'res_users_liwan_mobile_unique'

# Marks the one operation allowed to write res.company.liwan_self_grant_policy.
SELF_GRANT_POLICY_MARKER = 'liwan_core.self_grant_policy'
# Users whose whole proposed access one operation has already compared with the access they held before it.
SELF_GRANT_CHECKED_MARKER = 'liwan_core.self_grant_checked'
SELF_GRANT_POLICIES = ('restricted', 'allowed')

# Registering the company for VAT decides whether tax shows anywhere: the system administrator role only,
# never a custom role and never the vendor support role.
VAT_PERMISSION = 'settings.company.vat.manage'
SYSTEM_PERMISSIONS = {
    'access.users.read', 'access.users.grant', 'access.users.assign_roles',
    'access.users.disable', 'access.users.reset_password', 'access.roles.read',
    'access.roles.manage', 'access.audit.read', 'settings.branding.manage',
    'settings.company.read', 'settings.company.manage', VAT_PERMISSION,
}
# The keys liwan_core owns. Each application adds its own through
# _liwan_capability_definitions(); the composed map is the catalog.
CAPABILITIES = frozenset(SYSTEM_PERMISSIONS)

PERMISSION_DEPENDENCIES = {
    # A user's page shows the names and permissions of the roles assigned to them.
    'access.users.read': {'access.roles.read'},
    'access.users.grant': {'access.users.read', 'access.roles.read'},
    'access.users.assign_roles': {'access.users.read', 'access.roles.read'},
    'access.users.disable': {'access.users.read'},
    'access.users.reset_password': {'access.users.read'},
    'access.roles.manage': {'access.roles.read'},
    'settings.company.manage': {'settings.company.read'},
    VAT_PERMISSION: {'settings.company.manage'},
}


def _grantable(keys, known):
    """A contextual grant names registered keys and never an access-changing system key."""
    return bool(keys) and set(keys) <= known and not set(keys) & SYSTEM_PERMISSIONS


# Readable Arabic text for the codes an API caller can meet without any English message of their own.
ARABIC_MESSAGES = {
    'missing_dependency': 'أضف الصلاحيات التابعة أولًا.',
    'employee_contact_required': 'لا توجد جهة اتصال للموظف. أضف بياناته أولًا.',
    'role_name_exists': 'يوجد دور بهذا الاسم مسبقًا.',
    'user_already_disabled': 'الحساب موقوف مسبقًا.',
    'user_already_active': 'الحساب مفعّل مسبقًا.',
    'role_state_unchanged': 'الدور في هذه الحالة مسبقًا.',
    'invalid_token': 'الرابط غير صالح أو انتهت صلاحيته.',
    'weak_password': 'كلمة المرور يجب ألا تقل عن %d حرفًا.' % MIN_PASSWORD_LENGTH,
    'invalid_mobile': 'أدخل رقم جوال صحيحًا بالصيغة الدولية، مثل ‎+966500000000.',
    'mobile_taken': 'رقم الجوال مستخدم لدى مستخدم آخر.',
    'invitation_not_pending': 'الدعوة لم تعد بانتظار القبول.',
    'invitation_pending': 'هذا المستخدم لم يقبل الدعوة بعد. أعد إرسال الدعوة بدل رابط إعادة التعيين.',
    'user_inactive': 'الحساب موقوف.',
    'user_read_only': 'هذا الحساب للقراءة فقط ولا يمكنه التعديل. اطلب من مسؤول الحسابات إعادة مقعده الكامل.',
    'branch_read_only': 'هذا الفرع للقراءة فقط ولا يقبل التعديل حتى يُفعَّل مقعد الفرع.',
    'already_member': 'هذا الحساب عضو في المؤسسة مسبقًا.',
    'home_company': 'هذه هي المؤسسة الأصلية للحساب. لا تُزال منه عضوية المؤسسة الأصلية.',
    'self_grant_restricted': 'سياسة الشركة تمنعك من منح نفسك صلاحيات تتجاوز مسؤول النظام. اطلب من مسؤول آخر منحك إياها.',
    'storage_excess_blocked': 'هذا الملف يتجاوز سعة التخزين المتاحة. حرّر مساحة أو زد السعة لفتحه.',
}


class LiwanAccessRule(AccessError, ValidationError):
    def __init__(self, code, message=None, field=None, status=422, details=None):
        message = message or ARABIC_MESSAGES.get(code, code)
        super().__init__('%s: %s' % (code, message))
        self.code = code
        self.message = message
        self.field = field
        self.status = status
        self.details = details


class LiwanAccessService(models.AbstractModel):
    _name = 'liwan.access.service'
    _description = 'LiwanOS Access Service'
    _liwan_scope = 'global'

    @api.model
    def _liwan_pinned_company_ids(self):
        """The company set the API request pinned: current company + its own branches.

        Only the pin writes ``liwan_pinned_company_ids``; plain ORM code has no
        such context and stays on the current company alone, so a user's
        membership never widens a read by itself.
        """
        return self._liwan_scoped_company_ids()

    @api.model
    def _liwan_capability_definitions(self):
        """Pure descriptors composed through super(); each addon adds only the keys it owns."""
        return tuple({'key': key, 'owner': 'liwan_core'} for key in sorted(CAPABILITIES))

    @api.model
    def _liwan_permission_dependencies(self):
        """Permission key -> keys it requires. Applications extend this through super()."""
        return {key: set(required) for key, required in PERMISSION_DEPENDENCIES.items()}

    @api.model
    def _liwan_builtin_role_grants(self):
        """Built-in role xml id -> permission keys it must hold. Applications extend this through super().

        Built-in roles are noupdate records, so _liwan_repair_builtin_role_grants()
        links these grants on install and again on every upgrade.
        """
        return {
            'liwan_core.role_employee': set(),
            'liwan_core.role_system_admin': set(SYSTEM_PERMISSIONS),
            'liwan_core.role_vendor_support': SYSTEM_PERMISSIONS - {VAT_PERMISSION},
        }

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        """Keys a user not yet managed by roles holds through legacy groups. Applications extend this."""
        keys = set()
        if (
            user.has_group('liwan_core.group_access_admin')
            or user.has_group('liwan_core.group_customer_admin')
        ):
            keys |= SYSTEM_PERMISSIONS
        return keys

    @api.model
    def _liwan_record_company(self, record):
        """Company that scopes RECORD. Applications add fallbacks for records without company_id."""
        if 'company_id' in record._fields:
            return record.company_id
        msg = 'record_company_unknown'
        raise ValidationError(msg)

    @api.model
    def _liwan_scope_kinds(self):
        """Context kinds, beyond the company, that applications scope permissions to.

        The application owning a kind adds it through super()::

            {kind: {'owner': addon,
                    'permissions': {key, ...},
                    'roles': {role_key: {'name': {'ar': ..., 'en': ...}, 'grants': {key, ...}}}}}

        ``permissions`` are granted on a record of the kind by _liwan_contextual_capability();
        a role is held when _liwan_contextual_role_held() says so and adds its ``grants`` to
        the identity. A context kind is never assignable: role assignments stay company-scoped.
        """
        return {}

    @api.model
    def _liwan_scope_kind_map(self):
        """The registered scope kinds, validated; a malformed registration raises."""
        known = set(self._liwan_capability_map())
        kinds = self._liwan_scope_kinds()
        role_keys = set()
        for kind, spec in kinds.items():
            if (
                not IDENTIFIER.fullmatch(kind) or kind == 'company'
                or set(spec) != {'owner', 'permissions', 'roles'} or not spec['owner']
                or not _grantable(spec['permissions'], known)
            ):
                msg = 'scope_kind_invalid'
                raise ValidationError(msg)
            for role_key, role in spec['roles'].items():
                if (
                    not IDENTIFIER.fullmatch(role_key) or role_key in role_keys
                    or set(role) != {'name', 'grants'} or not role['name'].get('ar')
                    or not _grantable(role['grants'], known)
                ):
                    msg = 'scope_role_invalid'
                    raise ValidationError(msg)
                role_keys.add(role_key)
        return kinds

    @api.model
    def _liwan_contextual_keys(self):
        """Permission keys that some scope kind grants on its records."""
        return set().union(*(spec['permissions'] for spec in self._liwan_scope_kind_map().values()))

    @api.model
    def _liwan_contextual_capability(self, user, key, record):
        """Grant KEY on RECORD through the scope kind of RECORD. The owning application extends this.

        _liwan_has_capability() calls it only for the keys of a registered scope kind.
        """
        return False

    @api.model
    def _liwan_contextual_role_held(self, kind, role_key, user, capabilities):
        """Whether USER holds ROLE_KEY of KIND, given the CAPABILITIES its assignments give.

        The application that registers KIND extends this through super().
        """
        return False

    @api.model
    def _liwan_contextual_roles(self, user, capabilities):
        """The contextual roles USER holds and the keys they add, as (roles, keys)."""
        roles, keys = [], set()
        for kind, spec in self._liwan_scope_kind_map().items():
            for role_key, role in spec['roles'].items():
                if self._liwan_contextual_role_held(kind, role_key, user, capabilities):
                    roles.append({
                        'id': None, 'key': role_key,
                        'name': {'ar': role['name']['ar'], 'en': role['name'].get('en') or None},
                        'type': 'contextual', 'protected': True, 'source': 'contextual',
                    })
                    keys |= role['grants']
        return roles, keys

    @api.model
    def _liwan_customer_actor_keys(self):
        """Keys that make a user a customer access actor. Applications extend this through super()."""
        return {
            'access.users.grant', 'access.users.assign_roles',
            'access.users.disable', 'access.users.reset_password',
        }

    @api.model
    def _liwan_legacy_admin_roles(self):
        """Role keys granted to a preserved legacy administrator. Applications extend this through super()."""
        return ['system_admin']

    @api.model
    def _liwan_capability_map(self):
        seen = {}
        for item in self._liwan_capability_definitions():
            key = item.get('key')
            if not key or key in seen:
                msg = 'duplicate_or_invalid_capability'
                raise ValidationError(msg)
            seen[key] = item
        return seen

    @api.model
    def _liwan_branch_cache(self):
        # Cursor callbacks are cleared on commit and savepoint rollback (BaseCursor.clear).
        # Never share authorization results between transactions or registry workers.
        return self.env.cr.precommit.data.setdefault('liwan_core.branch_access_cache', {})

    @api.model
    def _liwan_clear_branch_cache(self):
        self.env.cr.precommit.data.pop('liwan_core.branch_access_cache', None)

    @api.model
    def _liwan_identity_management_state(self, user):
        self.env.cr.execute(
            '''
                SELECT users.liwan_access_managed, users.company_id,
                       EXISTS(
                           SELECT 1 FROM liwan_access_assignment assignment
                            WHERE assignment.user_id = users.id
                       )
                  FROM res_users users
                 WHERE users.id = %s
            ''',
            [user.id],
        )
        row = self.env.cr.fetchone()
        return (bool(row and (row[0] or row[2])), row[1] if row else None)

    @api.model
    def _liwan_capability_keys(self, user=None, company=None):
        user = user or self.env.user
        company = company or self.env.company
        cache = self._liwan_branch_cache()
        cache_key = ('keys', self.env.uid, self.env.su, self.env.company.id, user.id, company.id)
        if cache_key not in cache:
            cache[cache_key] = frozenset(self._liwan_compute_capability_keys(user, company))
        return set(cache[cache_key])

    @api.model
    def _liwan_compute_capability_keys(self, user, company):
        if user._is_superuser() or user.has_group('liwan_core.group_vendor_support'):
            return set(self._liwan_capability_map())
        self.env.cr.execute(
            '''
                SELECT DISTINCT permission.key
                  FROM liwan_access_assignment assignment
                  JOIN liwan_access_role_permission_rel rel ON rel.role_id = assignment.role_id
                  JOIN liwan_access_permission permission ON permission.id = rel.permission_id
                 WHERE assignment.user_id = %s AND assignment.company_id = %s
            ''',
            [user.id, company.id],
        )
        keys = {row[0] for row in self.env.cr.fetchall()}
        managed, main_company_id = self._liwan_identity_management_state(user)
        if not managed and main_company_id == company.id:
            keys |= self._liwan_legacy_capability_keys(user)
        keys |= self._liwan_inherited_capability_keys(user, company)
        return keys

    @api.model
    def _liwan_has_capability(self, user, key, record=None, company=None):
        company = company or self.env.company
        if record:
            record_company = self._liwan_record_company(record)
            if record_company:
                if company != self.env.company and company != record_company:
                    return False
                company = record_company
        if not self._liwan_branch_company_allowed(user, company):
            return False
        if key in self._liwan_capability_keys(user, company=company):
            return True
        if not record or key not in self._liwan_contextual_keys():
            return False
        return bool(self._liwan_contextual_capability(user, key, record))

    @api.model
    def _liwan_is_employee_principal(self, user=None, company=None):
        """Recognize the v1 Employee role and its legacy group equivalent."""
        user = user or self.env.user
        company = company or self.env.company
        managed, main_company_id = self._liwan_identity_management_state(user)
        if (
            not managed
            and main_company_id == company.id
            and user.has_group('liwan_core.group_employee')
        ):
            return True
        self.env.cr.execute(
            '''
                SELECT 1
                  FROM liwan_access_assignment assignment
                  JOIN liwan_access_role role ON role.id = assignment.role_id
                 WHERE assignment.user_id = %s
                   AND assignment.company_id = %s
                   AND role.key = 'employee'
                 LIMIT 1
            ''',
            [user.id, company.id],
        )
        return bool(self.env.cr.fetchone())

    @api.model
    def _liwan_require_capability(self, key, record=None):
        if not self._liwan_has_capability(self.env.user, key, record=record):
            msg = 'forbidden'
            raise AccessError(msg)

    @api.model
    def _liwan_assert_user_scope(self, user):
        if not user or user.company_id != self.env.company:
            msg = 'not_found'
            raise LiwanAccessRule(msg, 'user does not exist', status=404)
        return user

    @api.model
    def _liwan_identity(self, user=None):
        user = user or self.env.user
        company = self.env.company
        self.env.cr.execute(
            '''
                SELECT role.id, role.key, role.name_ar, role.name_en, role.type, role.protected
                  FROM liwan_access_assignment assignment
                  JOIN liwan_access_role role ON role.id = assignment.role_id
                 WHERE assignment.user_id = %s AND assignment.company_id = %s
                 ORDER BY assignment.id
            ''',
            [user.id, company.id],
        )
        roles = [{
            'id': row[0], 'key': row[1], 'name': {'ar': row[2], 'en': row[3] or None},
            'type': row[4], 'protected': row[5], 'source': 'assignment',
        } for row in self.env.cr.fetchall()]
        base_capabilities = self._liwan_capability_keys(user, company=company)
        extra_roles, extra_capabilities = self._liwan_contextual_roles(user, base_capabilities)
        roles.extend(extra_roles)
        capabilities = base_capabilities | extra_capabilities
        return {
            'roles': roles,
            'capabilities': sorted(capabilities),
            'version': company.liwan_access_policy_version,
        }

    @api.model
    def _liwan_bump_policy(self, companies):
        self._liwan_clear_branch_cache()
        company_ids = list(set(companies.ids))
        if not company_ids:
            return
        self.env.cr.execute(
            'UPDATE res_company SET liwan_access_policy_version = '
            'COALESCE(liwan_access_policy_version, 0) + 1 WHERE id = ANY(%s)',
            [company_ids],
        )
        companies.invalidate_recordset(['liwan_access_policy_version'])
        companies.modified(['liwan_access_policy_version'])

    @api.model
    def _liwan_policy_company(self, company=None):
        """The company whose access policy applies to COMPANY (default: the current one): a branch follows its root."""
        company = company or self.env.company
        return company.browse(int(company.parent_path.split('/')[0]))

    @api.model
    def _liwan_policy_values(self, company=None):
        """(self-grant policy, policy version) of the root COMPANY follows, readable from any branch of the tenant.

        A caller working in a branch need not belong to the root company, whose record ``res_company_rule_employee``
        then hides. Only these two settings are read elevated; the record itself stays in the caller's environment.
        """
        root = self._liwan_policy_company(company).sudo()
        return root.liwan_self_grant_policy, f'p{root.id}-v{root.liwan_access_policy_version}'

    @api.model
    def _liwan_access_policy_version(self):
        return self._liwan_policy_values()[1]

    @api.model
    def _liwan_access_policy(self):
        self._liwan_require_capability('access.roles.read')
        self_grant, version = self._liwan_policy_values()
        return {
            'self_grant': self_grant,
            'version': version,
        }

    @api.model
    def _liwan_set_self_grant_policy(self, expected_version, value):
        # The policy lives on the root company, so the caller needs both capabilities there, not only in a branch.
        company = self._liwan_policy_company()
        for key in ('access.users.assign_roles', 'settings.company.manage'):
            if not self._liwan_has_capability(self.env.user, key, company=company):
                msg = 'forbidden'
                raise AccessError(msg)
        if value not in SELF_GRANT_POLICIES:
            msg = 'invalid'
            raise LiwanAccessRule(msg, field='self_grant')
        self._liwan_lock_company(company)
        self.env.invalidate_all()
        current = self._liwan_access_policy_version()
        if not isinstance(expected_version, str) or expected_version != current:
            msg = 'conflict'
            raise LiwanAccessRule(msg, 'access policy was changed', status=409, details={'current_version': current})
        before = {'self_grant': company.liwan_self_grant_policy}
        if before['self_grant'] != value:
            with marked(self.env, {SELF_GRANT_POLICY_MARKER: {company.id}}):
                company.write({'liwan_self_grant_policy': value})
            self._liwan_bump_policy(company)
            self.env['liwan.access.audit']._liwan_log(
                'access.policy_changed', company, before=before, after={'self_grant': value},
            )
        return self._liwan_access_policy()

    @api.model
    def _liwan_assert_self_grant(self, user, company, keys_before, keys_after, roles=()):
        """Refuse USER, when they are the caller, a grant beyond the system administrator set under a restricted company.

        KEYS_BEFORE / KEYS_AFTER are the permission keys USER holds in COMPANY before and after the change.
        Keys already held, the system administrator grants and the Employee role (self-service) never count.
        """
        if self.env.is_superuser() or user != self.env.user or self._liwan_policy_values(company)[0] == 'allowed':
            return
        grants = self._liwan_builtin_role_grants()
        elevated = set(keys_after) - set(keys_before) - grants['liwan_core.role_system_admin'] \
            - grants['liwan_core.role_employee']
        if elevated:
            msg = 'self_grant_restricted'
            raise LiwanAccessRule(
                msg, status=403, field='assignments',
                details={'roles': sorted(set(roles)), 'permissions': sorted(elevated)},
            )

    @api.model
    def _liwan_user_version(self, user):
        return 'u%s-r%s' % (user.id, user.liwan_access_version)

    @api.model
    def _liwan_access_changed(self, users):
        """USERS' roles or role permissions changed. A shared service extends this through super() to tell them."""

    @api.model
    def _liwan_role_version(self, role):
        return 'r%s-v%s' % (role.id, role.version)

    @api.model
    def _liwan_check_user_version(self, user, expected):
        self._liwan_lock_company(user.company_id)
        self.env.invalidate_all()
        self.env.cr.execute(
            '''
                SELECT liwan_access_version FROM res_users WHERE id = %s FOR UPDATE
            ''',
            [user.id],
        )
        row = self.env.cr.fetchone()
        if not row:
            msg = 'not_found'
            raise LiwanAccessRule(msg, 'user does not exist', status=404)
        current = 'u%s-r%s' % (user.id, row[0])
        if expected != current:
            msg = 'conflict'
            raise LiwanAccessRule(msg, 'user was changed', status=409, details={'current_version': current})

    @api.model
    def _liwan_check_role_version(self, role, expected):
        self._liwan_lock_company(role.company_id or self.env.company)
        self.env.invalidate_all()
        self.env.cr.execute(
            'SELECT version FROM liwan_access_role WHERE id = %s FOR UPDATE',
            [role.id],
        )
        row = self.env.cr.fetchone()
        if not row:
            msg = 'not_found'
            raise LiwanAccessRule(msg, 'role does not exist', status=404)
        current = 'r%s-v%s' % (role.id, row[0])
        if expected != current:
            msg = 'conflict'
            raise LiwanAccessRule(msg, 'role was changed', status=409, details={'current_version': current})

    @api.model
    def _liwan_lock_company(self, company, *, shared=False):
        self.env.cr.execute(
            ("SELECT pg_advisory_xact_lock_shared(hashtext('liwan.access.last_admin'), %s)"
             if shared else "SELECT pg_advisory_xact_lock(hashtext('liwan.access.last_admin'), %s)"),
            [company.id],
        )

    @api.model
    def _liwan_assert_admin_survives(self, company, excluding_user=None):
        self.env['liwan.access.assignment'].flush_model(['user_id', 'company_id'])
        self.env.cr.execute('SELECT DISTINCT user_id FROM liwan_access_assignment WHERE company_id = %s', [company.id])
        assigned_ids = [user_id for user_id, in self.env.cr.fetchall()]
        users = self.env['res.users'].with_context(active_test=False).search([
            ('active', '=', True), '|', ('company_id', '=', company.id), ('id', 'in', assigned_ids),
        ])
        users = users.filtered(lambda u: not u.has_group('liwan_core.group_vendor_support'))
        if excluding_user:
            users -= excluding_user
        if not any(
            company.id in user._get_company_ids()
            and 'access.users.assign_roles' in self._liwan_capability_keys(user, company=company)
            for user in users
        ):
            msg = 'last_access_admin'
            raise LiwanAccessRule(msg, 'at least one access administrator is required', status=409)

    @api.model
    def _liwan_replace_assignments(self, user, assignments, expected_version=None):
        self._liwan_require_capability('access.users.assign_roles') if not self.env.is_superuser() else None
        if not self.env.is_superuser():
            self._liwan_assert_user_scope(user)
        if user == self.env.user and not any(
            self.env['liwan.access.role'].browse(item['role_id']).key == 'system_admin'
            for item in assignments
        ):
            msg = 'self_access_change'
            raise LiwanAccessRule(msg)
        if user.has_group('liwan_core.group_vendor_support'):
            msg = 'protected_user'
            raise LiwanAccessRule(msg, status=403)
        company = user.company_id
        self._liwan_lock_company(company)
        self.env.invalidate_all()
        user = self.env['res.users'].with_context(active_test=False).browse(user.id).exists()
        if not self.env.is_superuser():
            self._liwan_require_capability('access.users.assign_roles')
            self._liwan_assert_user_scope(user)
        if expected_version is not None:
            self._liwan_check_user_version(user, expected_version)
            self._liwan_assert_user_scope(user)
        role_ids = []
        existing = self.env['liwan.access.assignment'].search([
            ('user_id', '=', user.id), ('company_id', '=', company.id),
        ])
        existing_role_ids = set(existing.role_id.ids)
        for item in assignments:
            if set(item) - {'role_id', 'company_id', 'scope'}:
                msg = 'unsupported_scope'
                raise LiwanAccessRule(msg, field='assignments')
            company_id = item.get('company_id') or item.get('scope', {}).get('id')
            if company_id != company.id or item.get('scope', {}).get('kind', 'company') != 'company':
                msg = 'unsupported_scope'
                raise LiwanAccessRule(msg, field='assignments')
            role = self.env['liwan.access.role'].browse(item['role_id']).exists()
            if not role or not role.assignable:
                msg = 'invalid'
                raise LiwanAccessRule(msg, 'role is not assignable', field='assignments')
            if not role.active and role.id not in existing_role_ids:
                msg = 'role_disabled'
                raise LiwanAccessRule(msg, field='assignments')
            role_ids.append(role.id)
        if len(role_ids) != len(set(role_ids)):
            msg = 'invalid'
            raise LiwanAccessRule(msg, 'duplicate assignment', field='assignments')
        future_admin = any(
            'access.users.assign_roles' in role.permission_ids.mapped('key')
            for role in self.env['liwan.access.role'].browse(role_ids)
        )
        if self._liwan_has_capability(
            user, 'access.users.assign_roles', company=company,
        ) and not future_admin:
            self._liwan_assert_admin_survives(company, excluding_user=user)
        user._liwan_mark_access_managed()
        added = self.env['liwan.access.role'].browse(set(role_ids) - existing_role_ids)
        if user == self.env.user:
            # One comparison of the final access with the access held now: the steps below pass through states
            # (a role removed, its replacement not yet created) that must not count as the held access.
            self._liwan_assert_self_grant(
                user, company, self._liwan_capability_keys(user, company=company),
                set(self.env['liwan.access.role'].browse(role_ids).permission_ids.mapped('key')),
                added.mapped('key'),
            )
        before = [{'role_id': a.role_id.id, 'role_key': a.role_id.key,
                   'scope': {'kind': 'company', 'id': company.id}} for a in existing]
        existing.filtered(lambda assignment: assignment.role_id.id not in role_ids)._liwan_access_unlink()
        with marked(self.env, {SELF_GRANT_CHECKED_MARKER: {user.id}}):
            for role in added:
                self.env['liwan.access.assignment']._liwan_access_create({
                    'user_id': user.id, 'role_id': role.id, 'company_id': company.id,
                })
        after = [{'role_id': a.role_id.id, 'role_key': a.role_id.key,
                  'scope': {'kind': 'company', 'id': company.id}}
                 for a in self.env['liwan.access.assignment'].search([
                     ('user_id', '=', user.id), ('company_id', '=', company.id),
                 ])]
        if before != after:
            self.env['liwan.access.audit']._liwan_log(
                'user.roles_changed', user, before={'assignments': before}, after={'assignments': after},
            )
            if before:
                # A first grant is not a change of access the user needs to hear about.
                self._liwan_access_changed(user)
        return user

    @api.model
    def _liwan_disable_user(self, user, expected_version):
        self._liwan_require_capability('access.users.disable')
        self._liwan_assert_user_scope(user)
        if user == self.env.user:
            msg = 'self_access_change'
            raise LiwanAccessRule(msg)
        if user.has_group('liwan_core.group_vendor_support'):
            msg = 'protected_user'
            raise LiwanAccessRule(msg, status=403)
        self._liwan_lock_company(user.company_id)
        self.env.invalidate_all()
        user = self.env['res.users'].with_context(active_test=False).browse(user.id).exists()
        self._liwan_require_capability('access.users.disable')
        self._liwan_assert_user_scope(user)
        self._liwan_check_user_version(user, expected_version)
        self._liwan_require_capability('access.users.disable')
        self._liwan_assert_user_scope(user)
        if not user.active:
            msg = 'user_already_disabled'
            raise LiwanAccessRule(msg, status=409)
        if self._liwan_has_capability(
            user, 'access.users.assign_roles', company=user.company_id,
        ):
            self._liwan_assert_admin_survives(user.company_id, excluding_user=user)
        user._liwan_access_write({'active': False}, 'access.users.disable')
        self.env['liwan.access.audit']._liwan_log(
            'user.disabled', user, before={'active': True}, after={'active': False},
        )
        self._liwan_bump_policy(user.company_id)
        self.env.cr.postcommit.add(self.env.registry.clear_cache)
        return user

    @api.model
    def _liwan_tokens(self):
        """The account link table: system-only (``access_account_token_system``), read and written only here."""
        return self.env['liwan.account.token'].sudo()

    @api.model
    def _liwan_account_users(self):
        """Every user of the tenant, archived ones too, below the record rules.

        Forgot-password has no session, so the caller is the public user, who holds no read on ``res.users``.
        """
        return self.env['res.users'].sudo().with_context(active_test=False)

    @api.model
    def _liwan_normalize_mobile(self, value):
        cleaned = value.translate(MOBILE_SEPARATORS) if isinstance(value, str) else ''
        if not MOBILE_PATTERN.fullmatch(cleaned):
            msg = 'invalid_mobile'
            raise LiwanAccessRule(msg, field='mobile')
        return cleaned

    @api.model
    def _liwan_check_password(self, password, field='password'):
        if not isinstance(password, str) or len(password.strip()) < MIN_PASSWORD_LENGTH:
            msg = 'weak_password'
            raise LiwanAccessRule(msg, field=field)
        return password

    @api.model
    def _liwan_mobile_required(self, user):
        """Whether USER must still save a mobile number: every internal user but the root and vendor support."""
        return bool(
            user.active and not user.share and not user.liwan_mobile
            and not user._is_superuser()
            and not user.has_group('liwan_core.group_vendor_support'),
        )

    @api.model
    def _liwan_mobile_gate_enabled(self):
        """Whether API routes refuse a user who has no mobile number yet.

        Off while a test runs, like stock Odoo's outgoing mail (``ir.mail.server._disable_send``): the fixture
        users of every addon's HTTP tests hold no mobile number. The gate's own tests switch it on.
        """
        return not module.current_test

    @contextmanager
    def _liwan_mobile_guard(self):
        """Run a write of ``liwan_mobile`` (or of ``active``); a number another active user holds answers 409."""
        try:
            with self.env.cr.savepoint():
                yield
                self.env.flush_all()
        except IntegrityError as exc:
            if exc.pgcode != errorcodes.UNIQUE_VIOLATION or exc.diag.constraint_name != MOBILE_INDEX:
                raise
            msg = 'mobile_taken'
            raise LiwanAccessRule(msg, field='mobile', status=409) from None

    @api.model
    def _liwan_set_own_mobile(self, mobile):
        value = self._liwan_normalize_mobile(mobile)
        # The caller's own record without env.user's implicit elevation: the stock self-write path
        # (SELF_WRITEABLE_FIELDS) is what authorizes this one field.
        user = self.env['res.users'].browse(self.env.uid)
        with self._liwan_mobile_guard():
            user.write({'liwan_mobile': value})
        self.env['liwan.access.audit']._liwan_log(
            'user.mobile_set', user, before=None, after={'mobile_set': True},
        )
        return user

    @api.model
    def _liwan_awaiting_users(self, users):
        """The ids among USERS that were invited and have not accepted yet."""
        return self._liwan_tokens()._liwan_awaiting_user_ids(users.ids)

    @api.model
    def _liwan_invitation_states(self, users):
        """User id -> ``{state, delivery, sent_at, expires_at}`` of an active user awaiting acceptance, else None."""
        latest = self._liwan_tokens()._liwan_latest_invitations(users.ids)
        now = fields.Datetime.now()
        states = {}
        for user in users:
            token = latest.get(user.id)
            if not token or not user.active:
                states[user.id] = None
                continue
            states[user.id] = {
                'state': 'expired' if token.expires_at <= now else 'pending',
                'delivery': token.delivery,
                'sent_at': self._liwan_iso(token.sent_at),
                'expires_at': self._liwan_iso(token.expires_at),
            }
        return states

    @api.model
    def _liwan_iso(self, value):
        return fields.Datetime.to_string(value).replace(' ', 'T') + 'Z' if value else None

    @api.model
    def _liwan_send_link(self, user, purpose):
        """Revoke the user's unused link of PURPOSE, issue a new one and queue its email."""
        token, raw = self._liwan_tokens()._liwan_issue(user, purpose)
        self.env['liwan.account.mail']._liwan_send(token, raw)
        return token

    @api.model
    def _liwan_locked_target(self, user, expected_version, capability):
        """USER after the capability, scope, protection and version checks of an account mutation."""
        self._liwan_require_capability(capability)
        self._liwan_assert_user_scope(user)
        if user.has_group('liwan_core.group_vendor_support'):
            msg = 'protected_user'
            raise LiwanAccessRule(msg, status=403)
        self._liwan_check_user_version(user, expected_version)
        self._liwan_require_capability(capability)
        self._liwan_assert_user_scope(user)
        return user

    @api.model
    def _liwan_pending_target(self, user, expected_version):
        user = self._liwan_locked_target(user, expected_version, 'access.users.grant')
        if not user.active or user.id not in self._liwan_awaiting_users(user):
            msg = 'invitation_not_pending'
            raise LiwanAccessRule(msg, status=409)
        return user

    @api.model
    def _liwan_account_email_follows_login(self, user):
        """Whether editing the login of USER also edits the email of its contact.

        An application that shares the contact with its own records (an HR work contact) returns False.
        """
        return True

    @api.model
    def _liwan_invite_account(self, name, login, assignments, partner_id=False):
        """Create an internal user without a password in the current company and email its invitation.

        PARTNER_ID reuses an existing contact. A user whose invitation was cancelled is invited again in place.
        """
        self._liwan_require_capability('access.users.grant')
        self._liwan_assert_login_not_homed_elsewhere(login)
        existing = self.env['res.users'].with_context(active_test=False).search([('login', '=', login)], limit=1)
        if existing:
            user = self._liwan_reinvite(existing, name, partner_id)
        else:
            user = self._liwan_create_invitee(name, login, partner_id)
        self._liwan_replace_assignments(user, assignments)
        self._liwan_bump_policy(user.company_id)
        self._liwan_send_link(user, 'invite')
        self.env['liwan.access.audit']._liwan_log(
            'user.invited', user, before=None, after={'active': True},
        )
        return user

    @api.model
    def _liwan_create_invitee(self, name, login, partner_id):
        company = self.env.company
        vals = {
            'name': name, 'login': login,
            'company_id': company.id,
            'company_ids': [Command.set([company.id])],
            'group_ids': [Command.set([self.env.ref('base.group_user').id])],
        }
        try:
            with self.env.cr.savepoint():
                # The partner is created first so the protected create below may adopt it.
                if not partner_id:
                    with marked(self.env, {PARTNER_CREATE_MARKER: [self.env.uid]}):
                        partner_id = self.env['res.partner'].create({'name': name, 'email': login}).id
                vals['partner_id'] = partner_id
                # The view_group_hierarchy default is a web-client form helper whose
                # cold-cache build reads ir.module.category, which an access admin
                # may not read; it is never stored, so it is skipped.
                return self.env['res.users'].with_context(
                    no_reset_password=True, default_view_group_hierarchy=False,
                )._liwan_access_create(vals)
        except IntegrityError as exc:
            # The login is unique across companies, and record rules hide other
            # companies' users from the search of the caller. Any other violation is a bug.
            if (
                exc.pgcode != errorcodes.UNIQUE_VIOLATION
                or exc.diag.constraint_name != 'res_users_login_key'
            ):
                raise
            msg = 'account_exists'
            raise LiwanAccessRule(msg, field='login', status=409) from None

    @api.model
    def _liwan_reinvite(self, existing, name, partner_id=False):
        """Reactivate the archived row of a cancelled invitation; any other existing login is a conflict.

        A contact the caller names must be the one the archived user already has: the login stays reserved
        for the person it was first invited as.
        """
        self._liwan_assert_user_scope(existing)
        if (
            existing.active or existing.id not in self._liwan_awaiting_users(existing)
            or (partner_id and partner_id != existing.partner_id.id)
        ):
            msg = 'account_exists'
            raise LiwanAccessRule(msg, field='login', status=409)
        with marked(self.env, {PARTNER_GRANT_MARKER: [existing.partner_id.id]}):
            existing.partner_id.write({'name': name})
        existing._liwan_access_write({'active': True}, 'access.users.grant')
        return existing

    @api.model
    def _liwan_resend_invitation(self, user, expected_version):
        user = self._liwan_pending_target(user, expected_version)
        self._liwan_send_link(user, 'invite')
        user._liwan_bump_record_versions()
        self.env['liwan.access.audit']._liwan_log(
            'user.invitation_resent', user, before=None, after={'active': True},
        )
        return user

    @api.model
    def _liwan_change_invitation_login(self, user, login, expected_version):
        """Correct the email of a pending invitee: the old link dies and a new one goes to the new address."""
        user = self._liwan_pending_target(user, expected_version)
        before = user.login
        if login == before:
            return self._liwan_resend_invitation(user, self._liwan_user_version(user))
        if self.env['res.users'].with_context(active_test=False).search_count(
            [('login', '=', login), ('id', '!=', user.id)], limit=1,
        ):
            msg = 'account_exists'
            raise LiwanAccessRule(msg, field='login', status=409)
        vals = {'login': login}
        marks = {}
        if self._liwan_account_email_follows_login(user):
            vals['email'] = login
            marks[PARTNER_GRANT_MARKER] = [user.partner_id.id]
        try:
            with self.env.cr.savepoint(), marked(self.env, marks):
                user._liwan_access_write(vals, 'access.users.grant')
                self.env.flush_all()
        except IntegrityError as exc:
            if exc.pgcode != errorcodes.UNIQUE_VIOLATION or exc.diag.constraint_name != 'res_users_login_key':
                raise
            msg = 'account_exists'
            raise LiwanAccessRule(msg, field='login', status=409) from None
        self._liwan_send_link(user, 'invite')
        self.env['liwan.access.audit']._liwan_log(
            'user.invitation_login_changed', user, before={'login': before}, after={'login': login},
        )
        return user

    @api.model
    def _liwan_cancel_invitation(self, user, expected_version):
        """Archive a pending invitee (the seat is freed) and kill its link; the login stays reserved."""
        user = self._liwan_pending_target(user, expected_version)
        self._liwan_tokens()._liwan_revoke(user)
        user._liwan_access_write({'active': False}, 'access.users.grant')
        self.env['liwan.access.audit']._liwan_log(
            'user.invitation_cancelled', user, before={'active': True}, after={'active': False},
        )
        self._liwan_bump_policy(user.company_id)
        self.env.cr.postcommit.add(self.env.registry.clear_cache)
        return user

    @api.model
    def _liwan_reset_second_step(self, user, expected_version=None):
        """Administrator reset: drop USER's sign-in codes and every remembered device, and audit it.

        The user then signs in again with their password and a fresh code on a new device.
        """
        user = self._liwan_locked_target(user, expected_version, 'access.users.disable')
        user.lock_for_update(allow_referencing=True)
        self._liwan_codes()._liwan_revoke_user(user)
        self._liwan_devices()._liwan_revoke_user(user)
        self.env['liwan.access.audit']._liwan_log(
            'user.second_step_reset', user, before=None, after={'devices_revoked': True},
        )
        user._liwan_bump_record_versions()
        return user

    @api.model
    def _liwan_forget_devices(self, user, keep=None):
        """The account holder (or an administrator of the user) revokes remembered devices, keeping one."""
        if user != self.env.user:
            self._liwan_require_capability('access.users.disable')
            self._liwan_assert_user_scope(user)
        self._liwan_devices()._liwan_revoke_user(user, keep=keep)
        return user

    @api.model
    def _liwan_codes(self):
        """The sign-in code table: system-only (``access_login_code_system``), reached only from here."""
        return self.env['liwan.login.code'].sudo()

    @api.model
    def _liwan_devices(self):
        """The remembered-device table: system-only (``access_login_device_system``), reached only from here."""
        return self.env['liwan.login.device'].sudo()

    @api.model
    def _liwan_remembered_devices(self, user):
        """The ids of USER's usable remembered devices, newest first."""
        return self._liwan_devices().search([
            ('user_id', '=', user.id), ('revoked_at', '=', False),
            ('expires_at', '>', fields.Datetime.now()),
        ]).ids

    @api.model
    def _liwan_send_reset_link(self, user, expected_version):
        user = self._liwan_locked_target(user, expected_version, 'access.users.reset_password')
        if not user.active:
            msg = 'user_inactive'
            raise LiwanAccessRule(msg, status=409)
        if user.id in self._liwan_awaiting_users(user):
            msg = 'invitation_pending'
            raise LiwanAccessRule(msg, status=409)
        self._liwan_send_link(user, 'reset')
        user._liwan_bump_record_versions()
        self.env['liwan.access.audit']._liwan_log(
            'user.reset_link_sent', user, before=None, after={'link_sent': True},
        )
        return user

    @api.model
    def _liwan_request_password_reset(self, email):
        """Email a reset link to the active account of EMAIL. Silent for anything else: unknown, archived,
        protected, not yet accepted, or already over the hourly limit."""
        login = email_normalize(email) if isinstance(email, str) else False
        user = login and self._liwan_account_users().search([('login', '=', login)], limit=1)
        if user:
            # Serializes overlapping requests for one account, so the hourly count below is exact. A request
            # that finds the row already locked is a duplicate in flight and is dropped like any other.
            try:
                user.lock_for_update(allow_referencing=True)
            except LockError:
                return
        if (
            not user or not user.active or user.share or user._is_superuser()
            or user.has_group('liwan_core.group_vendor_support')
            or user.id in self._liwan_awaiting_users(user)
            or self._liwan_tokens()._liwan_recent_count(user, 'reset') >= RESET_LINKS_PER_HOUR
        ):
            return
        self._liwan_send_link(user, 'reset')
        self.env['liwan.access.audit']._liwan_log(
            'user.reset_link_requested', user, before=None, after={'link_sent': True},
        )

    @api.model
    def _liwan_token_usable(self, token, purpose):
        return bool(self._liwan_tokens()._liwan_usable(token, purpose))

    @api.model
    def _liwan_usable_link(self, token, purpose):
        link = self._liwan_tokens()._liwan_usable(token, purpose)
        if not link:
            msg = 'invalid_token'
            raise LiwanAccessRule(msg, status=404)
        return link

    @api.model
    def _liwan_use_link(self, link, vals, audit_action):
        """Consume LINK and write VALS (a password, maybe a mobile number) on its user as the account holder."""
        user = link.user_id
        with self._liwan_mobile_guard():
            if not link._liwan_consume():
                msg = 'invalid_token'
                raise LiwanAccessRule(msg, status=404)
            user._liwan_access_write(vals, 'access.users.reset_password')
        user.flush_recordset(['password'])
        self.env['liwan.access.audit']._liwan_log(
            audit_action, user, before=None, after={'sessions_revoked': True}, actor=user,
        )
        self.env.cr.postcommit.add(self.env.registry.clear_cache)
        return user

    @api.model
    def _liwan_accept_invitation(self, token, mobile, password):
        """Public: the invitee sets a password and a mobile number from the emailed link (works once)."""
        link = self._liwan_usable_link(token, 'invite')
        mobile = self._liwan_normalize_mobile(mobile)
        password = self._liwan_check_password(password)
        return self._liwan_use_link(link, {'password': password, 'liwan_mobile': mobile}, 'user.password_set')

    @api.model
    def _liwan_reset_password_with_token(self, token, password):
        """Public: the account holder chooses a new password from the emailed link (works once)."""
        link = self._liwan_usable_link(token, 'reset')
        password = self._liwan_check_password(password)
        return self._liwan_use_link(link, {'password': password}, 'user.password_reset')

    @api.model
    def _liwan_account_filter_keys(self):
        """Extra query keys of the user list. Bridges extend this through super()."""
        return frozenset()

    @api.model
    def _liwan_account_user_domain(self, filters):
        """Extra domain for the user list from the parsed FILTERS. Bridges extend this through super()."""
        return []

    @api.model
    def _liwan_account_extra_fields(self, user_ids):
        """User id -> extra payload fields merged into the admin user shape. Bridges extend this through super()."""
        states = self._liwan_invitation_states(self.env['res.users'].with_context(active_test=False).browse(user_ids))
        return {user_id: {'invitation': states[user_id]} for user_id in user_ids}

    @api.model
    def _liwan_assert_account_reactivation(self, user):
        """Raise to refuse reactivating USER. Bridges extend this through super()."""

    @api.model
    def _liwan_reactivate_user(self, user, expected_version):
        """Reactivate an archived user and email a link: a new invitation if it never accepted one, else a reset."""
        self._liwan_require_capability('access.users.disable')
        self._liwan_assert_user_scope(user)
        if user == self.env.user:
            msg = 'self_access_change'
            raise LiwanAccessRule(msg)
        user = self._liwan_locked_target(user, expected_version, 'access.users.disable')
        if user.active:
            msg = 'user_already_active'
            raise LiwanAccessRule(msg, status=409)
        self._liwan_assert_account_reactivation(user)
        purpose = 'invite' if user.id in self._liwan_awaiting_users(user) else 'reset'
        vals = {'active': True}
        if purpose == 'reset':
            # Only the emailed link may sign the user in again: the old password is replaced by a secret nobody
            # knows (it also ends every session, as the session token follows the password hash).
            vals['password'] = secrets.token_urlsafe(32)
        with self._liwan_mobile_guard():
            user._liwan_access_write(vals, 'access.users.disable')
        self._liwan_send_link(user, purpose)
        self.env['liwan.access.audit']._liwan_log(
            'user.reactivated', user, before={'active': False}, after={'active': True},
        )
        self._liwan_bump_policy(user.company_id)
        self.env.cr.postcommit.add(self.env.registry.clear_cache)
        return user

    @api.model
    def _liwan_capture_legacy_admin_ids(self):
        legacy = self.env.ref('liwan_core.group_customer_admin', raise_if_not_found=False)
        vendor = self.env.ref('liwan_core.group_vendor_support', raise_if_not_found=False)
        if not legacy:
            return []
        users = self.env['res.users'].with_context(active_test=False).search([
            ('all_group_ids', 'in', legacy.ids),
        ])
        return (users.filtered(lambda u: not vendor or vendor not in u.all_group_ids)).ids

    @api.model
    def _liwan_snapshot_legacy_admins(self):
        """Persist the pre-upgrade membership before the legacy group is narrowed."""
        params = self.env['ir.config_parameter']
        if params.get_param('liwan_core.access_migration_v1_done') == '1':
            params.set_param('liwan_core.legacy_access_admin_ids', '[]')
            return True
        candidate_ids = self._liwan_capture_legacy_admin_ids()
        params.set_param(
            'liwan_core.legacy_access_admin_ids', json.dumps(candidate_ids),
        )
        return True

    @api.model
    def _liwan_configure_permission_dependencies(self):
        """Write the composed dependency map. Every addon that adds permissions calls this from its data."""
        Permission = self.env['liwan.access.permission']
        dependencies = self._liwan_permission_dependencies()
        keys = set(dependencies).union(*dependencies.values())
        records = {
            permission.key: permission
            for permission in Permission.search([('key', 'in', sorted(keys))])
        }
        unknown = keys - set(records)
        if unknown:
            msg = 'permission dependency names unknown permissions: %s' % ', '.join(sorted(unknown))
            raise ValidationError(msg)
        for key, required in sorted(dependencies.items()):
            records[key].write({
                'dependency_ids': [Command.set([records[item].id for item in sorted(required)])],
            })
        self._liwan_complete_custom_role_dependencies()
        return True

    @api.model
    def _liwan_complete_custom_role_dependencies(self):
        """Add to every custom role the permissions its own permissions now depend on.

        A role saved before a dependency existed would otherwise keep failing for its users and
        could no longer be saved. Writing the role re-syncs its users' capability groups.
        """
        roles = self.env['liwan.access.role'].with_context(active_test=False).search([('type', '=', 'custom')])
        for role in roles:
            missing = role.permission_ids.dependency_ids - role.permission_ids
            if missing:
                role._liwan_do_write({'permission_ids': [Command.link(permission.id) for permission in missing]})
        return True

    @api.model
    def _liwan_repair_builtin_role_grants(self):
        """Link every missing built-in grant and never remove a link.

        Built-in roles are noupdate records, so seed XML cannot add a grant on
        an existing database. Every addon that contributes grants calls this
        from its data after its permission and role records. It is private and
        must run as the superuser from trusted module data.
        """
        if not self.env.is_superuser():
            msg = 'built-in role grant repair requires superuser'
            raise AccessError(msg)
        Permission = self.env['liwan.access.permission']
        for role_xmlid, keys in sorted(self._liwan_builtin_role_grants().items()):
            role = self.env.ref(role_xmlid, raise_if_not_found=False)
            if (
                not role
                or role._name != 'liwan.access.role'
                or role.type != 'built_in'
                or not role.protected
            ):
                msg = 'built-in role grant target is missing or not protected: %s' % role_xmlid
                raise ValidationError(msg)
            permissions = Permission.search([('key', 'in', sorted(keys))])
            unknown = set(keys) - set(permissions.mapped('key'))
            if unknown:
                msg = 'built-in role grant names unknown permissions: %s' % ', '.join(sorted(unknown))
                raise ValidationError(msg)
            missing = permissions - role.permission_ids
            if missing:
                role.write({
                    'permission_ids': [Command.link(permission.id) for permission in missing],
                })
        return True

    @api.model
    def _liwan_apply_legacy_admin_snapshot(self):
        params = self.env['ir.config_parameter']
        if params.get_param('liwan_core.access_migration_v1_done') == '1':
            return True
        raw = params.get_param(
            'liwan_core.legacy_access_admin_ids', '[]',
        )
        try:
            candidate_ids = [int(value) for value in json.loads(raw)]
        except (TypeError, ValueError, json.JSONDecodeError):
            candidate_ids = []
        self._liwan_migrate_legacy_admins(candidate_ids)
        params.set_param('liwan_core.legacy_access_admin_ids', '[]')
        params.set_param('liwan_core.access_migration_v1_done', '1')
        return True

    @api.model
    def _liwan_migrate_legacy_admins(self, candidate_ids):
        role_keys = self._liwan_legacy_admin_roles()
        roles = self.env['liwan.access.role'].search([
            ('key', 'in', role_keys),
        ])
        for user in self.env['res.users'].with_context(active_test=False).browse(candidate_ids).exists():
            created = False
            for role in roles:
                assignment = self.env['liwan.access.assignment'].search([
                    ('user_id', '=', user.id), ('role_id', '=', role.id),
                    ('company_id', '=', user.company_id.id),
                ], limit=1)
                if not assignment:
                    self.env['liwan.access.assignment'].create({
                        'user_id': user.id, 'role_id': role.id, 'company_id': user.company_id.id,
                    })
                    created = True
            if created and not self.env['liwan.access.audit'].search_count([
                ('action', '=', 'migration.legacy_admin_preserved'),
                ('target_type', '=', 'user'), ('target_id', '=', user.id),
            ]):
                self.env['liwan.access.audit']._liwan_log(
                    'migration.legacy_admin_preserved', user,
                    before={'groups': ['liwan_core.group_customer_admin']},
                    after={'roles': role_keys},
                    actor=False,
                )
