import { z } from 'zod'

export const LocalizedLabelSchema = z.object({ ar: z.string(), en: z.string().nullable() }).strict()

/** A capability key: two or more lowercase identifier segments joined by dots (`<app>.<resource>.<action>`). */
export const CAPABILITY_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
/** A lowercase identifier: a permission domain or a notification kind. */
export const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/

/**
 * The capability keys of today's applications, for typed code. A newer application registers
 * its own keys on the server; the contract accepts any well-formed key and the server
 * (liwan_core `liwan.access.permission`) validates the same pattern.
 */
export const KNOWN_CAPABILITIES = [
  'access.users.read',
  'access.users.grant',
  'access.users.assign_roles',
  'access.users.disable',
  'access.users.reset_password',
  'access.roles.read',
  'access.roles.manage',
  'access.audit.read',
  'hr.employees.read',
  'hr.employees.manage',
  'hr.employees.archive',
  'hr.employees.access_status.read',
  'hr.departments.read',
  'hr.departments.manage',
  'hr.leave.read',
  'hr.leave.request',
  'hr.leave.approve',
  'hr.leave.manage',
  'hr.recruitment.read',
  'hr.recruitment.manage',
  'hr.shifts.read',
  'hr.shifts.manage',
  'hr.onboarding.read',
  'hr.onboarding.manage',
  'hr.offboarding.read',
  'hr.offboarding.manage',
  'hr.assets.read',
  'hr.assets.manage',
  'hr.warnings.read',
  'hr.warnings.manage',
  'hr.payroll.read',
  'hr.payroll.manage',
  'hr.payroll.approve',
  'hr.payroll.config',
  'hr.payroll.audit.read',
  'hr.payroll.finance.manage',
  'documents.items.read',
  'documents.items.manage',
  'documents.items.archive',
  'documents.access.manage',
  'documents.library.manage',
  'pmo.projects.read',
  'pmo.projects.create',
  'pmo.projects.manage',
  'pmo.settings.manage',
  'pmo.tasks.read',
  'pmo.tasks.create',
  'pmo.tasks.write',
  'pmo.tasks.approve',
  'settings.branding.manage',
  'settings.company.read',
  'settings.company.manage',
  'meetings.read',
  'meetings.create',
  'meetings.manage',
] as const
export type KnownCapability = typeof KNOWN_CAPABILITIES[number]
/** Any capability: today's keys keep their literal type for autocomplete. */
export type Capability = KnownCapability | (string & {})
export const CapabilitySchema = z.string().regex(CAPABILITY_KEY_PATTERN)

/** The permission domains (role-screen groups) of today's applications; a newer application adds its own. */
export const KNOWN_PERMISSION_DOMAINS = ['access', 'hr', 'pmo', 'meetings', 'settings', 'documents'] as const
export type KnownPermissionDomain = typeof KNOWN_PERMISSION_DOMAINS[number]
export type PermissionDomain = KnownPermissionDomain | (string & {})
export const PermissionDomainSchema = z.string().regex(IDENTIFIER_PATTERN)

/**
 * `company`, or a context kind an installed application registers on the server
 * (liwan_core `_liwan_scope_kinds`). A context kind is a read-only source: assignments stay company-scoped.
 */
export const ScopeKindSchema = z.string().regex(IDENTIFIER_PATTERN)
export const ScopeRefSchema = z.object({
  kind: ScopeKindSchema,
  id: z.number().int().positive(),
  name: z.string(),
}).strict()
export type ScopeKind = z.infer<typeof ScopeKindSchema>
export type ScopeRef = z.infer<typeof ScopeRefSchema>

export const RoleAssignmentInputSchema = z.object({
  role_id: z.number().int().positive(),
  scope: z.object({ kind: z.literal('company'), id: z.number().int().positive() }).strict(),
}).strict()
export type RoleAssignmentInput = z.infer<typeof RoleAssignmentInputSchema>

export const RoleRefSchema = z.object({
  id: z.number().int().positive().nullable(),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: LocalizedLabelSchema,
  type: z.enum(['built_in', 'custom', 'contextual']),
  protected: z.boolean(),
}).strict().superRefine((role, ctx) => {
  if (role.type === 'contextual' && role.id !== null) ctx.addIssue({ code: 'custom', message: 'contextual source must not have an id', path: ['id'] })
  if (role.type !== 'contextual' && role.id === null) ctx.addIssue({ code: 'custom', message: 'only contextual sources may omit an id', path: ['id'] })
})
export type RoleRef = z.infer<typeof RoleRefSchema>

export const RoleAssignmentSchema = z.object({
  id: z.number().int().positive(),
  role: RoleRefSchema,
  scope: ScopeRefSchema,
}).strict().superRefine((assignment, ctx) => {
  if (assignment.role.id === null) ctx.addIssue({ code: 'custom', message: 'assignment role must have an id', path: ['role', 'id'] })
  if (assignment.scope.kind !== 'company') ctx.addIssue({ code: 'custom', message: 'assignments only support company scopes', path: ['scope', 'kind'] })
})
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>

const AllowedRoleActionsSchema = z.enum(['read', 'edit', 'disable', 'enable', 'delete', 'clone'])
export const RoleSummarySchema = z.object({
  id: z.number().int().positive(),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: LocalizedLabelSchema,
  description: z.string(),
  type: z.enum(['built_in', 'custom']),
  active: z.boolean(),
  protected: z.boolean(),
  assignable: z.boolean(),
  user_count: z.number().int().nonnegative(),
  version: z.string().min(1),
}).strict()
export type RoleSummary = z.infer<typeof RoleSummarySchema>

export const RoleDetailSchema = RoleSummarySchema.extend({
  permissions: z.array(CapabilitySchema),
  allowed_actions: z.array(AllowedRoleActionsSchema),
}).strict()
export type RoleDetail = z.infer<typeof RoleDetailSchema>
export const RoleListSchema = z.object({ items: z.array(RoleSummarySchema), total: z.number().int().nonnegative() }).strict()
export type RoleList = z.infer<typeof RoleListSchema>

// Typed as known keys so a misspelt entry fails the type check.
const ACCESS_CHANGING: readonly KnownCapability[] = [
  'access.users.grant',
  'access.users.assign_roles',
  'access.users.disable',
  'access.users.reset_password',
  'access.roles.manage',
]
const ACCESS_CHANGING_CAPABILITIES = new Set<Capability>(ACCESS_CHANGING)
// The foundation's own keys (liwan_core SYSTEM_PERMISSIONS): never granted through a context kind.
const SYSTEM: readonly KnownCapability[] = [
  ...ACCESS_CHANGING,
  'access.users.read',
  'access.roles.read',
  'access.audit.read',
  'settings.branding.manage',
  'settings.company.read',
  'settings.company.manage',
]
const SYSTEM_CAPABILITIES = new Set<Capability>(SYSTEM)
const RoleNameSchema = z.object({ ar: z.string().trim().min(1), en: z.string().trim().min(1).nullable() }).strict()
const CustomRolePermissionsSchema = z.array(CapabilitySchema).refine(
  (permissions) => permissions.every((permission) => !ACCESS_CHANGING_CAPABILITIES.has(permission)),
  { message: 'custom roles cannot include access-changing permissions' },
)
export const RoleCreateInputSchema = z.object({
  name: RoleNameSchema,
  description: z.string(),
  permissions: CustomRolePermissionsSchema,
}).strict()
export type RoleCreateInput = z.infer<typeof RoleCreateInputSchema>
export const RolePatchInputSchema = z.object({
  name: RoleNameSchema.optional(),
  description: z.string().optional(),
  permissions: CustomRolePermissionsSchema.optional(),
  expected_version: z.string().trim().min(1),
}).strict().refine((patch) => patch.name !== undefined || patch.description !== undefined || patch.permissions !== undefined, { message: 'at least one role field is required' })
export type RolePatchInput = z.infer<typeof RolePatchInputSchema>
export const RoleCloneInputSchema = z.object({ name: RoleNameSchema }).strict()
export type RoleCloneInput = z.infer<typeof RoleCloneInputSchema>
export const RoleStateInputSchema = z.object({ expected_version: z.string().trim().min(1) }).strict()
export type RoleStateInput = z.infer<typeof RoleStateInputSchema>
export const PermissionDefinitionSchema = z.object({
  key: CapabilitySchema,
  domain: PermissionDomainSchema,
  resource: z.string(),
  action: z.string(),
  label: LocalizedLabelSchema,
  description: LocalizedLabelSchema,
  dependencies: z.array(CapabilitySchema),
  scopes: z.array(z.object({ kind: ScopeKindSchema, assignable: z.boolean() }).strict()).min(1),
  custom_role_allowed: z.boolean(),
  sensitive: z.boolean(),
}).strict().superRefine((definition, ctx) => {
  if (ACCESS_CHANGING_CAPABILITIES.has(definition.key) && definition.custom_role_allowed) {
    ctx.addIssue({ code: 'custom', message: 'access-changing permission cannot be assigned to custom roles', path: ['custom_role_allowed'] })
  }
  if (!definition.scopes.some((scope) => scope.kind === 'company' && scope.assignable)) {
    ctx.addIssue({ code: 'custom', message: 'every permission must support an assignable company scope', path: ['scopes'] })
  }
  if (new Set(definition.scopes.map((scope) => scope.kind)).size !== definition.scopes.length) {
    ctx.addIssue({ code: 'custom', message: 'scope kinds must be unique', path: ['scopes'] })
  }
  if (definition.scopes.some((scope) => scope.kind !== 'company' && scope.assignable)) {
    ctx.addIssue({ code: 'custom', message: 'context scopes are read-only contextual sources', path: ['scopes'] })
  }
  if (SYSTEM_CAPABILITIES.has(definition.key) && definition.scopes.some((scope) => scope.kind !== 'company')) {
    ctx.addIssue({ code: 'custom', message: 'a foundation permission cannot be contextual', path: ['scopes'] })
  }
})
export type PermissionDefinition = z.infer<typeof PermissionDefinitionSchema>
export const PermissionCatalogSchema = z.object({
  items: z.array(PermissionDefinitionSchema),
  total: z.number().int().nonnegative(),
  version: z.string().min(1),
}).strict()
export type PermissionCatalog = z.infer<typeof PermissionCatalogSchema>

/** Where a role or capability comes from: a company assignment, or a context kind's contextual role. */
export const RoleSourceSchema = z.enum(['assignment', 'contextual'])
export const MeRoleSchema = RoleRefSchema.extend({ source: RoleSourceSchema }).strict()
export type MeRole = z.infer<typeof MeRoleSchema>

export const EmployeeRefSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  department: z.object({ id: z.number().int().positive(), name: z.string() }).strict().nullable(),
}).strict()
export type EmployeeRef = z.infer<typeof EmployeeRefSchema>

export const CapabilitySourceSchema = z.object({
  role_assignment_id: z.number().int().positive().nullable(),
  role: RoleRefSchema,
  scope: ScopeRefSchema,
  source: RoleSourceSchema,
}).strict()
export type CapabilitySource = z.infer<typeof CapabilitySourceSchema>
export const EffectiveCapabilitySchema = z.object({ key: CapabilitySchema, sources: z.array(CapabilitySourceSchema) }).strict()
export type EffectiveCapability = z.infer<typeof EffectiveCapabilitySchema>

export const AdminUserSummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  login: z.string(),
  /** Present only when the employee-account bridge is installed. */
  employee: EmployeeRefSchema.nullable().optional(),
  active: z.boolean(),
  protected: z.boolean(),
  assignments: z.array(RoleAssignmentSchema),
  version: z.string().min(1),
}).strict()
export type AdminUserSummary = z.infer<typeof AdminUserSummarySchema>
export const AdminUserDetailSchema = AdminUserSummarySchema.extend({
  capabilities: z.array(EffectiveCapabilitySchema),
  allowed_actions: z.array(z.enum(['read', 'assign_roles', 'reset_password', 'disable', 'reactivate'])),
}).strict()
export type AdminUserDetail = z.infer<typeof AdminUserDetailSchema>
export const AdminUserListSchema = z.object({ items: z.array(AdminUserSummarySchema), total: z.number().int().nonnegative() }).strict()
export type AdminUserList = z.infer<typeof AdminUserListSchema>

/** The length counts the trimmed value, but the server keeps the exact text, whitespace included. */
export const PasswordInputSchema = z.string().refine((value) => value.trim().length >= 8, { message: 'password must have at least 8 characters' })
const NonEmptyVersionSchema = z.string().trim().min(1)
const uniqueAssignments = (assignments: RoleAssignmentInput[]) => {
  const keys = assignments.map((assignment) => `${assignment.role_id}:${assignment.scope.kind}:${assignment.scope.id}`)
  return new Set(keys).size === keys.length
}
export const AssignmentListSchema = z.array(RoleAssignmentInputSchema).min(1).refine(uniqueAssignments, { message: 'assignments must be unique' })

export const GrantAccountInputSchema = z.object({
  name: z.string().trim().min(1),
  login: z.string().trim().email(),
  password: PasswordInputSchema,
  assignments: AssignmentListSchema,
}).strict()
export type GrantAccountInput = z.infer<typeof GrantAccountInputSchema>
export const UpdateUserAccessInputSchema = z.object({ assignments: AssignmentListSchema, expected_version: NonEmptyVersionSchema }).strict()
export type UpdateUserAccessInput = z.infer<typeof UpdateUserAccessInputSchema>
export const ResetPasswordInputSchema = z.object({ password: PasswordInputSchema, expected_version: NonEmptyVersionSchema }).strict()
export type ResetPasswordInput = z.infer<typeof ResetPasswordInputSchema>
export const ChangeUserStateInputSchema = z.object({ expected_version: NonEmptyVersionSchema, password: PasswordInputSchema.optional() }).strict()
export type ChangeUserStateInput = z.infer<typeof ChangeUserStateInputSchema>

export const AuditActionSchema = z.enum([
  'user.granted', 'user.employee_linked', 'user.roles_changed', 'user.disabled', 'user.reactivated',
  'user.password_reset', 'user.branch_roles_changed', 'branch.policy_changed',
  'employee.archived_access_disabled', 'role.created',
  'role.updated', 'role.disabled', 'role.enabled', 'role.deleted',
  'migration.legacy_admin_preserved',
])
export type AuditAction = z.infer<typeof AuditActionSchema>
export const AuditActorSchema = z.object({ id: z.number().int().positive(), name: z.string(), login: z.string() }).strict().nullable()
export const AuditTargetSchema = z.object({ type: z.enum(['user', 'role', 'company']), id: z.number().int().positive(), name: z.string() }).strict()
export const AccessAuditSummarySchema = z.object({
  id: z.number().int().positive(),
  occurred_at: z.string().datetime({ offset: true }),
  actor: AuditActorSchema,
  action: AuditActionSchema,
  target: AuditTargetSchema,
  result: z.literal('succeeded'),
}).strict()
export type AccessAuditSummary = z.infer<typeof AccessAuditSummarySchema>

const AuditValuesSchema = z.record(z.string(), z.unknown()).nullable()
const containsSensitiveAuditKey = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsSensitiveAuditKey)
  return Object.entries(value).some(([key, nested]) => /password|secret|token|session_id|hash/i.test(key) || containsSensitiveAuditKey(nested))
}
export const AccessAuditDetailSchema = AccessAuditSummarySchema.extend({
  before: AuditValuesSchema,
  after: AuditValuesSchema,
  reason: z.string().nullable(),
}).strict().superRefine((event, ctx) => {
  if (containsSensitiveAuditKey(event.before)) ctx.addIssue({ code: 'custom', message: 'sensitive audit keys are forbidden', path: ['before'] })
  if (containsSensitiveAuditKey(event.after)) ctx.addIssue({ code: 'custom', message: 'sensitive audit keys are forbidden', path: ['after'] })
})
export type AccessAuditDetail = z.infer<typeof AccessAuditDetailSchema>
export const AccessAuditListSchema = z.object({ items: z.array(AccessAuditSummarySchema), total: z.number().int().nonnegative() }).strict()
export type AccessAuditList = z.infer<typeof AccessAuditListSchema>
