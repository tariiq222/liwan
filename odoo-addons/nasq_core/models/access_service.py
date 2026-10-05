# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo import api, models
from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Command

SYSTEM_PERMISSIONS = {
    'access.users.read', 'access.users.grant', 'access.users.assign_roles',
    'access.users.disable', 'access.users.reset_password', 'access.roles.read',
    'access.roles.manage', 'access.audit.read', 'settings.branding.manage',
}
HR_PERMISSIONS = {
    'hr.employees.read', 'hr.employees.manage', 'hr.employees.archive',
    'hr.employees.access_status.read', 'hr.departments.read',
    'hr.departments.manage', 'hr.documents.read', 'hr.documents.manage',
}
PMO_PERMISSIONS = {
    'pmo.projects.read', 'pmo.projects.create', 'pmo.projects.manage',
    'pmo.settings.manage', 'pmo.tasks.read', 'pmo.tasks.create',
    'pmo.tasks.write', 'pmo.tasks.approve',
}
MEETINGS_PERMISSIONS = {
    'meetings.read', 'meetings.create', 'meetings.manage',
}
EMPLOYEE_APP_PERMISSIONS = {
    'hr.employees.read', 'hr.departments.read', 'hr.documents.read',
    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write',
    'meetings.read',
}
PROJECT_CONTEXTUAL_PERMISSIONS = {
    'pmo.projects.manage', 'pmo.tasks.write', 'pmo.tasks.approve',
}
CAPABILITIES = frozenset(
    SYSTEM_PERMISSIONS | HR_PERMISSIONS | PMO_PERMISSIONS | MEETINGS_PERMISSIONS,
)

PERMISSION_DEPENDENCIES = {
    'access.users.grant': {'access.users.read', 'access.roles.read'},
    'access.users.assign_roles': {'access.users.read', 'access.roles.read'},
    'access.users.disable': {'access.users.read'},
    'access.users.reset_password': {'access.users.read'},
    'access.roles.manage': {'access.roles.read'},
    'hr.employees.manage': {'hr.employees.read'},
    'hr.employees.archive': {'hr.employees.read'},
    'hr.employees.access_status.read': {'hr.employees.read'},
    'hr.departments.manage': {'hr.departments.read'},
    'hr.documents.manage': {'hr.documents.read'},
    'pmo.projects.create': {'pmo.projects.read'},
    'pmo.projects.manage': {'pmo.projects.read'},
    'pmo.settings.manage': {'pmo.projects.read'},
    'pmo.tasks.create': {'pmo.tasks.read', 'pmo.projects.read'},
    'pmo.tasks.write': {'pmo.tasks.read'},
    'pmo.tasks.approve': {'pmo.tasks.read'},
    'meetings.create': {'meetings.read'},
    'meetings.manage': {'meetings.read'},
}


class NasqAccessRule(AccessError, ValidationError):
    def __init__(self, code, message=None, field=None, status=422, details=None):
        super().__init__('%s: %s' % (code, message or code))
        self.code = code
        self.message = message or code
        self.field = field
        self.status = status
        self.details = details


class NasqAccessService(models.AbstractModel):
    _name = 'nasq.access.service'
    _description = 'Nasq Access Service'
    _nasq_scope = 'global'

    @api.model
    def _nasq_capability_definitions(self):
        """Pure descriptors composed through super(); each addon adds only the keys it owns."""
        return tuple({'key': key, 'owner': 'nasq_core'} for key in sorted(CAPABILITIES))

    @api.model
    def _nasq_permission_dependencies(self):
        """Permission key -> keys it requires. Applications extend this through super()."""
        return {key: set(required) for key, required in PERMISSION_DEPENDENCIES.items()}

    @api.model
    def _nasq_builtin_role_grants(self):
        """Built-in role xml id -> permission keys it must hold. Applications extend this through super().

        Built-in roles are noupdate records, so _nasq_repair_builtin_role_grants()
        links these grants on install and again on every upgrade.
        """
        return {
            'nasq_core.role_employee': set(EMPLOYEE_APP_PERMISSIONS),
            'nasq_core.role_pmo_manager': set(PMO_PERMISSIONS),
            'nasq_core.role_hr_manager': set(HR_PERMISSIONS),
            'nasq_core.role_system_admin': SYSTEM_PERMISSIONS | MEETINGS_PERMISSIONS,
            'nasq_core.role_vendor_support': set(CAPABILITIES),
        }

    @api.model
    def _nasq_legacy_capability_keys(self, user):
        """Keys a user not yet managed by roles holds through legacy groups. Applications extend this."""
        keys = set()
        if (
            user.has_group('nasq_core.group_access_admin')
            or user.has_group('nasq_core.group_customer_admin')
        ):
            keys |= SYSTEM_PERMISSIONS | MEETINGS_PERMISSIONS
        if (
            user.has_group('nasq_core.group_hr_manager')
            or user.has_group('hr.group_hr_manager')
        ):
            keys |= HR_PERMISSIONS
        if (
            user.has_group('nasq_core.group_pmo_manager')
            or user.has_group('project.group_project_manager')
        ):
            keys |= PMO_PERMISSIONS
        if user.has_group('nasq_core.group_employee'):
            keys |= EMPLOYEE_APP_PERMISSIONS
        return keys

    @api.model
    def _nasq_record_company(self, record):
        """Company that scopes RECORD. Applications add fallbacks for records without company_id."""
        if 'company_id' in record._fields:
            return record.company_id
        return record.project_id.company_id

    @api.model
    def _nasq_contextual_capability(self, user, key, record):
        """Grant KEY on RECORD beyond assigned roles. Applications extend this through super()."""
        if key not in PROJECT_CONTEXTUAL_PERMISSIONS:
            return False
        project = record if record._name == 'project.project' else record.project_id
        return bool(project and project.user_id == user)

    @api.model
    def _nasq_identity_extra(self, user, capabilities):
        """Contextual roles for /me and the keys they add, as (roles, keys). Applications extend this."""
        roles = []
        extra = set()
        company = self.env.company
        if (
            'project.project' in self.env.registry.models
            and 'pmo.projects.read' in capabilities
            and self.env['project.project'].with_user(user).search_count([
            ('user_id', '=', user.id), ('company_id', '=', company.id),
            ])
        ):
            roles.append({
                'id': None, 'key': 'project_owner',
                'name': {'ar': 'مسؤول مشروع', 'en': 'Project owner'},
                'type': 'contextual', 'protected': True, 'source': 'project_owner',
            })
            extra |= PROJECT_CONTEXTUAL_PERMISSIONS
        if (
            'nasq.pmo.settings' in self.env.registry.models
            and self._nasq_is_employee_principal(user, company=company)
            and self.env['nasq.pmo.settings'].with_user(user).get()['project_creators'] == 'employees'
        ):
            roles.append({
                'id': None, 'key': 'project_creation_policy',
                'name': {'ar': 'سياسة إنشاء المشاريع', 'en': 'Project creation policy'},
                'type': 'contextual', 'protected': True, 'source': 'policy',
            })
            extra.add('pmo.projects.create')
        return roles, extra

    @api.model
    def _nasq_customer_actor_keys(self):
        """Keys that make a user a customer access actor. Applications extend this through super()."""
        return {
            'access.users.grant', 'access.users.assign_roles',
            'access.users.disable', 'access.users.reset_password',
            'hr.employees.archive',
        }

    @api.model
    def _nasq_legacy_admin_roles(self):
        """Role keys granted to a preserved legacy administrator. Applications extend this through super()."""
        return ['system_admin', 'hr_manager', 'pmo_manager']

    @api.model
    def _nasq_capability_map(self):
        seen = {}
        for item in self._nasq_capability_definitions():
            key = item.get('key')
            if not key or key in seen:
                msg = 'duplicate_or_invalid_capability'
                raise ValidationError(msg)
            seen[key] = item
        return seen

    @api.model
    def _nasq_identity_management_state(self, user):
        self.env.cr.execute(
            '''
                SELECT users.nasq_access_managed, users.company_id,
                       EXISTS(
                           SELECT 1 FROM nasq_access_assignment assignment
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
    def _nasq_capability_keys(self, user=None, company=None):
        user = user or self.env.user
        company = company or self.env.company
        if user._is_superuser() or user.has_group('nasq_core.group_vendor_support'):
            return set(self._nasq_capability_map())
        self.env.cr.execute(
            '''
                SELECT DISTINCT permission.key
                  FROM nasq_access_assignment assignment
                  JOIN nasq_access_role_permission_rel rel ON rel.role_id = assignment.role_id
                  JOIN nasq_access_permission permission ON permission.id = rel.permission_id
                 WHERE assignment.user_id = %s AND assignment.company_id = %s
            ''',
            [user.id, company.id],
        )
        keys = {row[0] for row in self.env.cr.fetchall()}
        managed, main_company_id = self._nasq_identity_management_state(user)
        if not managed and main_company_id == company.id:
            keys |= self._nasq_legacy_capability_keys(user)
        return keys

    @api.model
    def _nasq_has_capability(self, user, key, record=None, company=None):
        company = company or self.env.company
        if record:
            record_company = self._nasq_record_company(record)
            if record_company and record_company != company:
                return False
        if key in self._nasq_capability_keys(user, company=company):
            return True
        if not record:
            return False
        return bool(self._nasq_contextual_capability(user, key, record))

    @api.model
    def _nasq_is_employee_principal(self, user=None, company=None):
        """Recognize the v1 Employee role and its legacy group equivalent."""
        user = user or self.env.user
        company = company or self.env.company
        managed, main_company_id = self._nasq_identity_management_state(user)
        if (
            not managed
            and main_company_id == company.id
            and user.has_group('nasq_core.group_employee')
        ):
            return True
        self.env.cr.execute(
            '''
                SELECT 1
                  FROM nasq_access_assignment assignment
                  JOIN nasq_access_role role ON role.id = assignment.role_id
                 WHERE assignment.user_id = %s
                   AND assignment.company_id = %s
                   AND role.key = 'employee'
                 LIMIT 1
            ''',
            [user.id, company.id],
        )
        return bool(self.env.cr.fetchone())

    @api.model
    def _nasq_require_capability(self, key, record=None):
        if not self._nasq_has_capability(self.env.user, key, record=record):
            msg = 'forbidden'
            raise AccessError(msg)

    @api.model
    def _nasq_assert_user_scope(self, user):
        if not user or user.company_id != self.env.company:
            msg = 'not_found'
            raise NasqAccessRule(msg, 'user does not exist', status=404)
        return user

    @api.model
    def _nasq_identity(self, user=None):
        user = user or self.env.user
        company = self.env.company
        self.env.cr.execute(
            '''
                SELECT role.id, role.key, role.name_ar, role.name_en, role.type, role.protected
                  FROM nasq_access_assignment assignment
                  JOIN nasq_access_role role ON role.id = assignment.role_id
                 WHERE assignment.user_id = %s AND assignment.company_id = %s
                 ORDER BY assignment.id
            ''',
            [user.id, company.id],
        )
        roles = [{
            'id': row[0], 'key': row[1], 'name': {'ar': row[2], 'en': row[3] or None},
            'type': row[4], 'protected': row[5], 'source': 'assignment',
        } for row in self.env.cr.fetchall()]
        base_capabilities = self._nasq_capability_keys(user, company=company)
        extra_roles, extra_capabilities = self._nasq_identity_extra(user, base_capabilities)
        roles.extend(extra_roles)
        capabilities = base_capabilities | extra_capabilities
        return {
            'roles': roles,
            'capabilities': sorted(capabilities),
            'version': company.nasq_access_policy_version,
        }

    @api.model
    def _nasq_bump_policy(self, companies):
        company_ids = list(set(companies.ids))
        if not company_ids:
            return
        self.env.cr.execute(
            'UPDATE res_company SET nasq_access_policy_version = '
            'COALESCE(nasq_access_policy_version, 0) + 1 WHERE id = ANY(%s)',
            [company_ids],
        )
        companies.invalidate_recordset(['nasq_access_policy_version'])
        companies.modified(['nasq_access_policy_version'])

    @api.model
    def _nasq_user_version(self, user):
        return 'u%s-r%s-v%s' % (
            user.id, user.nasq_access_version, user.company_id.nasq_access_policy_version,
        )

    @api.model
    def _nasq_role_version(self, role):
        return 'r%s-v%s' % (role.id, role.version)

    @api.model
    def _nasq_check_user_version(self, user, expected):
        self._nasq_lock_company(user.company_id)
        self.env.invalidate_all()
        self.env.cr.execute(
            '''
                SELECT users.nasq_access_version, company.nasq_access_policy_version
                  FROM res_users users
                  JOIN res_company company ON company.id = users.company_id
                 WHERE users.id = %s
                 FOR UPDATE OF users
            ''',
            [user.id],
        )
        row = self.env.cr.fetchone()
        if not row:
            msg = 'not_found'
            raise NasqAccessRule(msg, 'user does not exist', status=404)
        current = 'u%s-r%s-v%s' % (user.id, row[0], row[1])
        if expected != current:
            msg = 'conflict'
            raise NasqAccessRule(msg, 'user was changed', status=409, details={'current_version': current})

    @api.model
    def _nasq_check_role_version(self, role, expected):
        self._nasq_lock_company(role.company_id or self.env.company)
        self.env.invalidate_all()
        self.env.cr.execute(
            'SELECT version FROM nasq_access_role WHERE id = %s FOR UPDATE',
            [role.id],
        )
        row = self.env.cr.fetchone()
        if not row:
            msg = 'not_found'
            raise NasqAccessRule(msg, 'role does not exist', status=404)
        current = 'r%s-v%s' % (role.id, row[0])
        if expected != current:
            msg = 'conflict'
            raise NasqAccessRule(msg, 'role was changed', status=409, details={'current_version': current})

    @api.model
    def _nasq_lock_company(self, company):
        self.env.cr.execute(
            "SELECT pg_advisory_xact_lock(hashtext('nasq.access.last_admin'), %s)",
            [company.id],
        )

    @api.model
    def _nasq_assert_admin_survives(self, company, excluding_user=None):
        users = self.env['res.users'].with_context(active_test=False).search([
            ('active', '=', True), ('company_id', '=', company.id),
        ])
        users = users.filtered(lambda u: not u.has_group('nasq_core.group_vendor_support'))
        if excluding_user:
            users -= excluding_user
        if not any(
            self._nasq_has_capability(
                user, 'access.users.assign_roles', company=company,
            )
            for user in users
        ):
            msg = 'last_access_admin'
            raise NasqAccessRule(msg, 'at least one access administrator is required', status=409)

    @api.model
    def _nasq_replace_assignments(self, user, assignments, expected_version=None):
        self._nasq_require_capability('access.users.assign_roles') if not self.env.is_superuser() else None
        if not self.env.is_superuser():
            self._nasq_assert_user_scope(user)
        if user == self.env.user and not any(
            self.env['nasq.access.role'].browse(item['role_id']).key == 'system_admin'
            for item in assignments
        ):
            msg = 'self_access_change'
            raise NasqAccessRule(msg)
        if user.has_group('nasq_core.group_vendor_support'):
            msg = 'protected_user'
            raise NasqAccessRule(msg, status=403)
        company = user.company_id
        self._nasq_lock_company(company)
        self.env.invalidate_all()
        user = self.env['res.users'].with_context(active_test=False).browse(user.id).exists()
        if not self.env.is_superuser():
            self._nasq_require_capability('access.users.assign_roles')
            self._nasq_assert_user_scope(user)
        if expected_version is not None:
            self._nasq_check_user_version(user, expected_version)
            self._nasq_assert_user_scope(user)
        role_ids = []
        existing = self.env['nasq.access.assignment'].search([
            ('user_id', '=', user.id), ('company_id', '=', company.id),
        ])
        existing_role_ids = set(existing.role_id.ids)
        for item in assignments:
            if set(item) - {'role_id', 'company_id', 'scope'}:
                msg = 'unsupported_scope'
                raise NasqAccessRule(msg, field='assignments')
            company_id = item.get('company_id') or item.get('scope', {}).get('id')
            if company_id != company.id or item.get('scope', {}).get('kind', 'company') != 'company':
                msg = 'unsupported_scope'
                raise NasqAccessRule(msg, field='assignments')
            role = self.env['nasq.access.role'].browse(item['role_id']).exists()
            if not role or not role.assignable:
                msg = 'invalid'
                raise NasqAccessRule(msg, 'role is not assignable', field='assignments')
            if not role.active and role.id not in existing_role_ids:
                msg = 'role_disabled'
                raise NasqAccessRule(msg, field='assignments')
            role_ids.append(role.id)
        if len(role_ids) != len(set(role_ids)):
            msg = 'invalid'
            raise NasqAccessRule(msg, 'duplicate assignment', field='assignments')
        future_admin = any(
            'access.users.assign_roles' in role.permission_ids.mapped('key')
            for role in self.env['nasq.access.role'].browse(role_ids)
        )
        if self._nasq_has_capability(
            user, 'access.users.assign_roles', company=company,
        ) and not future_admin:
            self._nasq_assert_admin_survives(company, excluding_user=user)
        user._nasq_mark_access_managed()
        before = [{'role_id': a.role_id.id, 'role_key': a.role_id.key,
                   'scope': {'kind': 'company', 'id': company.id}} for a in existing]
        existing.filtered(lambda assignment: assignment.role_id.id not in role_ids)._nasq_access_unlink()
        for role_id in set(role_ids) - existing_role_ids:
            self.env['nasq.access.assignment']._nasq_access_create({
                'user_id': user.id, 'role_id': role_id, 'company_id': company.id,
            })
        after = [{'role_id': a.role_id.id, 'role_key': a.role_id.key,
                  'scope': {'kind': 'company', 'id': company.id}}
                 for a in self.env['nasq.access.assignment'].search([
                     ('user_id', '=', user.id), ('company_id', '=', company.id),
                 ])]
        if before != after:
            self.env['nasq.access.audit']._nasq_log(
                'user.roles_changed', user, before={'assignments': before}, after={'assignments': after},
            )
        return user

    @api.model
    def _nasq_disable_user(self, user, expected_version):
        self._nasq_require_capability('access.users.disable')
        self._nasq_assert_user_scope(user)
        if user == self.env.user:
            msg = 'self_access_change'
            raise NasqAccessRule(msg)
        if user.has_group('nasq_core.group_vendor_support'):
            msg = 'protected_user'
            raise NasqAccessRule(msg, status=403)
        self._nasq_lock_company(user.company_id)
        self.env.invalidate_all()
        user = self.env['res.users'].with_context(active_test=False).browse(user.id).exists()
        self._nasq_require_capability('access.users.disable')
        self._nasq_assert_user_scope(user)
        self._nasq_check_user_version(user, expected_version)
        self._nasq_require_capability('access.users.disable')
        self._nasq_assert_user_scope(user)
        if self._nasq_has_capability(
            user, 'access.users.assign_roles', company=user.company_id,
        ):
            self._nasq_assert_admin_survives(user.company_id, excluding_user=user)
        user._nasq_access_write({'active': False}, 'access.users.disable')
        self.env['nasq.access.audit']._nasq_log(
            'user.disabled', user, before={'active': True}, after={'active': False},
        )
        self._nasq_bump_policy(user.company_id)
        self.env.cr.postcommit.add(self.env.registry.clear_cache)
        return user

    @api.model
    def _nasq_reset_password(self, user, password, expected_version):
        self._nasq_require_capability('access.users.reset_password')
        self._nasq_assert_user_scope(user)
        if user.has_group('nasq_core.group_vendor_support'):
            msg = 'protected_user'
            raise NasqAccessRule(msg, status=403)
        self._nasq_check_user_version(user, expected_version)
        self._nasq_require_capability('access.users.reset_password')
        self._nasq_assert_user_scope(user)
        user._nasq_access_write({'password': password}, 'access.users.reset_password')
        user.flush_recordset(['password'])
        self.env['nasq.access.audit']._nasq_log(
            'user.password_reset', user, before=None, after={'sessions_revoked': True},
        )
        self.env.cr.postcommit.add(self.env.registry.clear_cache)
        return user

    @api.model
    def _nasq_reactivate_user(self, user, password, expected_version, employee_id):
        self._nasq_require_capability('access.users.disable')
        self._nasq_assert_user_scope(user)
        if user == self.env.user:
            msg = 'self_access_change'
            raise NasqAccessRule(msg)
        if user.has_group('nasq_core.group_vendor_support'):
            msg = 'protected_user'
            raise NasqAccessRule(msg, status=403)
        self._nasq_check_user_version(user, expected_version)
        self._nasq_require_capability('access.users.disable')
        self._nasq_assert_user_scope(user)
        prepared = self._nasq_hr_prepare_account(employee_id, 'reactivate')
        if prepared.get('existing_user_id') != user.id:
            msg = 'not_found'
            raise NasqAccessRule(msg, status=404)
        if not prepared['employee_active']:
            msg = 'employee_archived'
            raise NasqAccessRule(msg, status=409)
        user._nasq_access_write(
            {'active': True, 'password': password}, 'access.users.disable',
        )
        self.env['nasq.access.audit']._nasq_log(
            'user.reactivated', user, before={'active': False}, after={'active': True},
        )
        self._nasq_bump_policy(user.company_id)
        self.env.cr.postcommit.add(self.env.registry.clear_cache)
        return user

    @api.model
    def _nasq_disable_linked_user_from_hr(self, employee_id, user_id, expected_user_version):
        self._nasq_require_capability('hr.employees.archive')
        user = self.env['res.users'].browse(user_id).exists()
        if not user:
            msg = 'not_found'
            raise NasqAccessRule(msg, status=404)
        self._nasq_assert_user_scope(user)
        if user == self.env.user:
            msg = 'self_access_change'
            raise NasqAccessRule(msg)
        if user.has_group('nasq_core.group_vendor_support'):
            msg = 'protected_user'
            raise NasqAccessRule(msg, status=403)
        self._nasq_lock_company(user.company_id)
        self.env.invalidate_all()
        self._nasq_require_capability('hr.employees.archive')
        user = self.env['res.users'].with_context(active_test=False).browse(user.id).exists()
        self._nasq_assert_user_scope(user)
        self._nasq_check_user_version(user, expected_user_version)
        self._nasq_assert_user_scope(user)
        if self._nasq_has_capability(
            user, 'access.users.assign_roles', company=user.company_id,
        ):
            self._nasq_assert_admin_survives(user.company_id, excluding_user=user)
        user._nasq_access_write({'active': False}, 'hr.employees.archive')
        self.env['nasq.access.audit']._nasq_log(
            'employee.archived_access_disabled', user,
            before={'active': True, 'employee_id': employee_id},
            after={'active': False, 'employee_id': employee_id},
        )
        self._nasq_bump_policy(user.company_id)
        self.env.cr.postcommit.add(self.env.registry.clear_cache)

    @api.model
    def _nasq_capture_legacy_admin_ids(self):
        legacy = self.env.ref('nasq_core.group_customer_admin', raise_if_not_found=False)
        vendor = self.env.ref('nasq_core.group_vendor_support', raise_if_not_found=False)
        if not legacy:
            return []
        users = self.env['res.users'].with_context(active_test=False).search([
            ('all_group_ids', 'in', legacy.ids),
        ])
        return (users.filtered(lambda u: not vendor or vendor not in u.all_group_ids)).ids

    @api.model
    def _nasq_snapshot_legacy_admins(self):
        """Persist the pre-upgrade membership before the legacy group is narrowed."""
        params = self.env['ir.config_parameter']
        if params.get_param('nasq_core.access_migration_v1_done') == '1':
            params.set_param('nasq_core.legacy_access_admin_ids', '[]')
            return True
        candidate_ids = self._nasq_capture_legacy_admin_ids()
        params.set_param(
            'nasq_core.legacy_access_admin_ids', json.dumps(candidate_ids),
        )
        return True

    @api.model
    def _nasq_configure_permission_dependencies(self):
        """Write the composed dependency map. Every addon that adds permissions calls this from its data."""
        Permission = self.env['nasq.access.permission']
        dependencies = self._nasq_permission_dependencies()
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
        return True

    @api.model
    def _nasq_repair_builtin_role_grants(self):
        """Link every missing built-in grant and never remove a link.

        Built-in roles are noupdate records, so seed XML cannot add a grant on
        an existing database. Every addon that contributes grants calls this
        from its data after its permission and role records. It is private and
        must run as the superuser from trusted module data.
        """
        if not self.env.is_superuser():
            msg = 'built-in role grant repair requires superuser'
            raise AccessError(msg)
        Permission = self.env['nasq.access.permission']
        for role_xmlid, keys in sorted(self._nasq_builtin_role_grants().items()):
            role = self.env.ref(role_xmlid, raise_if_not_found=False)
            if (
                not role
                or role._name != 'nasq.access.role'
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
    def _nasq_apply_legacy_admin_snapshot(self):
        params = self.env['ir.config_parameter']
        if params.get_param('nasq_core.access_migration_v1_done') == '1':
            return True
        raw = params.get_param(
            'nasq_core.legacy_access_admin_ids', '[]',
        )
        try:
            candidate_ids = [int(value) for value in json.loads(raw)]
        except (TypeError, ValueError, json.JSONDecodeError):
            candidate_ids = []
        self._nasq_migrate_legacy_admins(candidate_ids)
        params.set_param('nasq_core.legacy_access_admin_ids', '[]')
        params.set_param('nasq_core.access_migration_v1_done', '1')
        return True

    @api.model
    def _nasq_migrate_legacy_admins(self, candidate_ids):
        role_keys = self._nasq_legacy_admin_roles()
        roles = self.env['nasq.access.role'].search([
            ('key', 'in', role_keys),
        ])
        for user in self.env['res.users'].with_context(active_test=False).browse(candidate_ids).exists():
            created = False
            for role in roles:
                assignment = self.env['nasq.access.assignment'].search([
                    ('user_id', '=', user.id), ('role_id', '=', role.id),
                    ('company_id', '=', user.company_id.id),
                ], limit=1)
                if not assignment:
                    self.env['nasq.access.assignment'].create({
                        'user_id': user.id, 'role_id': role.id, 'company_id': user.company_id.id,
                    })
                    created = True
            if created and not self.env['nasq.access.audit'].search_count([
                ('action', '=', 'migration.legacy_admin_preserved'),
                ('target_type', '=', 'user'), ('target_id', '=', user.id),
            ]):
                self.env['nasq.access.audit']._nasq_log(
                    'migration.legacy_admin_preserved', user,
                    before={'groups': ['nasq_core.group_customer_admin']},
                    after={'roles': role_keys},
                    actor=False,
                )

    # Pillar hooks. nasq_hr overrides these methods.
    @api.model
    def _nasq_hr_prepare_account(self, employee_id, operation):
        msg = 'hr_integration_unavailable'
        raise NasqAccessRule(msg)

    @api.model
    def _nasq_hr_link_account(self, employee_id, user_id):
        msg = 'hr_integration_unavailable'
        raise NasqAccessRule(msg)

    @api.model
    def _nasq_hr_user_domain(self, filters):
        return []

    @api.model
    def _nasq_hr_employee_refs(self, user_ids):
        return {user_id: None for user_id in user_ids}

    @api.model
    def _nasq_hr_account_candidates(self, filters, limit, offset):
        msg = 'hr_integration_unavailable'
        raise NasqAccessRule(msg)
