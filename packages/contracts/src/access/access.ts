import { z } from 'zod'

export const LocalizedLabelSchema = z.object({ ar: z.string(), en: z.string().nullable() }).strict()

/** A capability key: two or more lowercase identifier segments joined by dots (`<app>.<resource>.<action>`). */
export const CAPABILITY_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
/** A lowercase identifier: a permission domain or a notification kind. */
export const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/

/**
 * The capability keys of today's applications, for typed code. A newer application registers
 * its own keys on the server; the contract accepts any well-formed key and the server
 * (webvue_core `webvue.access.permission`) validates the same pattern.
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
  'hr.documents.read',
  'hr.documents.manage',
  'hr.leave.read',
  'hr.leave.request',
  'hr.leave.approve',
  'hr.leave.manage',
  'pmo.projects.read',
  'pmo.projects.create',
  'pmo.projects.manage',
  'pmo.settings.manage',
  'pmo.tasks.read',
  'pmo.tasks.create',
  'pmo.tasks.write',
  'pmo.tasks.approve',
  'settings.branding.manage',
  'meetings.read',
  'meetings.create',
  'meetings.manage',
] as const
export type KnownCapability = typeof KNOWN_CAPABILITIES[number]
/** Any capability: today's keys keep their literal type for autocomplete. */
export type Capability = KnownCapability | (string & {})
export const CapabilitySchema = z.string().regex(CAPABILITY_KEY_PATTERN)

/** The permission domains (role-screen groups) of today's applications; a newer application adds its own. */
export const KNOWN_PERMISSION_DOMAINS = ['access', 'hr', 'pmo', 'meetings', 'settings'] as const
export type KnownPermissionDomain = typeof KNOWN_PERMISSION_DOMAINS[number]
export type PermissionDomain = KnownPermissionDomain | (string & {})
export const PermissionDomainSchema = z.string().regex(IDENTIFIER_PATTERN)

export const ScopeKindSchema = z.enum(['company', 'project'])
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
  const isContextualNullRole = role.type === 'contextual' && (role.key === 'project_owner' || role.key === 'project_creation_policy')
  if (isContextualNullRole && role.id !== null) ctx.addIssue({ code: 'custom', message: 'contextual source must not have an id', path: ['id'] })
  if (!isContextualNullRole && role.id === null) ctx.addIssue({ code: 'custom', message: 'only contextual sources may omit an id', path: ['id'] })
  if (role.type === 'contextual' && !isContextualNullRole) ctx.addIssue({ code: 'custom', message: 'unknown contextual role', path: ['key'] })
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
  if (definition.key !== 'pmo.projects.manage' && definition.key !== 'pmo.tasks.write' && definition.key !== 'pmo.tasks.approve' && definition.scopes.some((scope) => scope.kind === 'project')) {
    ctx.addIssue({ code: 'custom', message: 'project scope is contextual and limited to PMO permissions', path: ['scopes'] })
  }
  if (definition.scopes.some((scope) => scope.kind === 'project' && scope.assignable)) {
    ctx.addIssue({ code: 'custom', message: 'project scopes are read-only contextual sources', path: ['scopes'] })
  }
})
export type PermissionDefinition = z.infer<typeof PermissionDefinitionSchema>
export const PermissionCatalogSchema = z.object({
  items: z.array(PermissionDefinitionSchema),
  total: z.number().int().nonnegative(),
  version: z.string().min(1),
}).strict()
export type PermissionCatalog = z.infer<typeof PermissionCatalogSchema>

export const MeRoleSchema = RoleRefSchema.extend({ source: z.enum(['assignment', 'project_owner', 'policy']) }).strict()
export type MeRole = z.infer<typeof MeRoleSchema>

export const EmployeeRefSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  department: z.object({ id: z.number().int().positive(), name: z.string() }).strict().nullable(),
}).strict()
export type EmployeeRef = z.infer<typeof EmployeeRefSchema>

export const AdminUserCandidateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  department: z.object({ id: z.number().int().positive(), name: z.string() }).strict().nullable(),
  work_email: z.string().email().nullable(),
  active: z.boolean(),
  user_id: z.number().int().positive().nullable(),
  access_active: z.boolean().nullable(),
}).strict()
export type AdminUserCandidate = z.infer<typeof AdminUserCandidateSchema>
export const AdminUserCandidateListSchema = z.object({ items: z.array(AdminUserCandidateSchema), total: z.number().int().nonnegative() }).strict()
export type AdminUserCandidateList = z.infer<typeof AdminUserCandidateListSchema>

export const CapabilitySourceSchema = z.object({
  role_assignment_id: z.number().int().positive().nullable(),
  role: RoleRefSchema,
  scope: ScopeRefSchema,
  source: z.enum(['assignment', 'project_owner', 'policy']),
}).strict()
export type CapabilitySource = z.infer<typeof CapabilitySourceSchema>
export const EffectiveCapabilitySchema = z.object({ key: CapabilitySchema, sources: z.array(CapabilitySourceSchema) }).strict()
export type EffectiveCapability = z.infer<typeof EffectiveCapabilitySchema>

export const AdminUserSummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  login: z.string(),
  employee: EmployeeRefSchema.nullable(),
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

const PasswordInputSchema = z.string().trim().min(8)
const NonEmptyVersionSchema = z.string().trim().min(1)
const uniqueAssignments = (assignments: RoleAssignmentInput[]) => {
  const keys = assignments.map((assignment) => `${assignment.role_id}:${assignment.scope.kind}:${assignment.scope.id}`)
  return new Set(keys).size === keys.length
}
const AssignmentListSchema = z.array(RoleAssignmentInputSchema).min(1).refine(uniqueAssignments, { message: 'assignments must be unique' })

export const GrantAccountInputSchema = z.object({
  employee_id: z.number().int().positive(),
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
  'user.granted', 'user.roles_changed', 'user.disabled', 'user.reactivated',
  'user.password_reset', 'employee.archived_access_disabled', 'role.created',
  'role.updated', 'role.disabled', 'role.enabled', 'role.deleted',
  'migration.legacy_admin_preserved',
])
export type AuditAction = z.infer<typeof AuditActionSchema>
export const AuditActorSchema = z.object({ id: z.number().int().positive(), name: z.string(), login: z.string() }).strict().nullable()
export const AuditTargetSchema = z.object({ type: z.enum(['user', 'role']), id: z.number().int().positive(), name: z.string() }).strict()
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
