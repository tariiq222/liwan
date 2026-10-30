import type { AccessAuditSummary } from '@liwan/contracts'

/** The locale key of each access-log action. */
export const AUDIT_ACTION_LABELS: Record<AccessAuditSummary['action'], string> = {
  'user.granted': 'access.audit.actions.userGranted',
  'user.employee_linked': 'access.audit.actions.userEmployeeLinked',
  'user.branch_roles_changed': 'access.audit.actions.userBranchRolesChanged',
  'branch.policy_changed': 'access.audit.actions.branchPolicyChanged',
  'user.roles_changed': 'access.audit.actions.userRolesChanged',
  'user.disabled': 'access.audit.actions.userDisabled',
  'user.reactivated': 'access.audit.actions.userReactivated',
  'user.password_reset': 'access.audit.actions.userPasswordReset',
  'employee.archived_access_disabled': 'access.audit.actions.employeeArchived',
  'role.created': 'access.audit.actions.roleCreated',
  'role.updated': 'access.audit.actions.roleUpdated',
  'role.disabled': 'access.audit.actions.roleDisabled',
  'role.enabled': 'access.audit.actions.roleEnabled',
  'role.deleted': 'access.audit.actions.roleDeleted',
  'migration.legacy_admin_preserved': 'access.audit.actions.legacyAdminPreserved',
}
