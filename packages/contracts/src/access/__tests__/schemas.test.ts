import {
  AccessAuditDetailSchema,
  AccessAuditListSchema,
  AccessAuditSummarySchema,
  EmployeeAccountCandidateListSchema,
  EmployeeAccountInputSchema,
  AdminUserDetailSchema,
  AdminUserListSchema,
  AdminUserSummarySchema,
  AuditActionSchema,
  CapabilitySchema,
  ChangeUserStateInputSchema,
  EffectiveCapabilitySchema,
  GrantAccountInputSchema,
  KNOWN_CAPABILITIES,
  KNOWN_PERMISSION_DOMAINS,
  type KnownCapability,
  MeRoleSchema,
  PermissionCatalogSchema,
  PermissionDefinitionSchema,
  ResetPasswordInputSchema,
  RoleAssignmentInputSchema,
  RoleAssignmentSchema,
  RoleCreateInputSchema,
  RoleDetailSchema,
  RoleListSchema,
  RoleRefSchema,
  RoleSummarySchema,
  ScopeRefSchema,
  UpdateUserAccessInputSchema,
} from '..'

const CAPABILITIES = [
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

const COMPANY = { kind: 'company' as const, id: 1, name: 'شركة المثال' }
const ROLE = {
  id: 4,
  key: 'hr_manager',
  name: { ar: 'مسؤول موارد بشرية', en: 'HR manager' },
  type: 'built_in' as const,
  protected: true,
}
const ASSIGNMENT = { id: 44, role: ROLE, scope: COMPANY }
const EMPLOYEE = {
  id: 31,
  name: 'سارة محمد',
  department: { id: 3, name: 'الموارد البشرية' },
}
const USER_SUMMARY = {
  id: 18,
  name: 'سارة محمد',
  login: 'sara@example.com',
  employee: EMPLOYEE,
  active: true,
  protected: false,
  assignments: [ASSIGNMENT],
  version: 'u18-a3-v7',
}
const USER_DETAIL = {
  ...USER_SUMMARY,
  capabilities: [{
    key: 'hr.employees.archive' as const,
    sources: [{
      role_assignment_id: 44,
      role: ROLE,
      scope: COMPANY,
      source: 'assignment' as const,
    }],
  }],
  allowed_actions: ['read', 'assign_roles', 'reset_password', 'disable'] as const,
}
const AUDIT_SUMMARY = {
  id: 107,
  occurred_at: '2026-09-05T14:20:30Z',
  actor: { id: 7, name: 'مدير النظام', login: 'admin@example.com' },
  action: 'user.roles_changed' as const,
  target: { type: 'user' as const, id: 18, name: 'سارة محمد' },
  result: 'succeeded' as const,
}

describe('access capability and reference schemas', () => {
  it("lists today's capability catalog and accepts any well-formed key", () => {
    expect(KNOWN_CAPABILITIES).toEqual(CAPABILITIES)
    expect(KNOWN_CAPABILITIES).toHaveLength(47)
    for (const key of [...CAPABILITIES, 'sales.orders.read', 'sales.orders.write', 'customer_acme.reports.export']) {
      expect(CapabilitySchema.parse(key)).toBe(key)
    }
    for (const key of ['sales', 'Sales.orders.read', 'sales..read', 'sales.orders.', '.sales.read', 'sales.orders read', 'sales-orders.read', '']) {
      expect(() => CapabilitySchema.parse(key)).toThrow()
    }
    // @ts-expect-error a misspelt key of today's catalog is not a KnownCapability (checked by `npm -w packages/contracts run build`)
    const typo: KnownCapability = 'pmo.task.read'
    expect(KNOWN_CAPABILITIES).not.toContain(typo)
  })

  it('accepts company scopes and rejects contextual project scopes for writes', () => {
    expect(ScopeRefSchema.parse(COMPANY)).toEqual(COMPANY)
    expect(RoleAssignmentInputSchema.parse({ role_id: 4, scope: { kind: 'company', id: 1 } })).toEqual({
      role_id: 4,
      scope: { kind: 'company', id: 1 },
    })
    expect(() => RoleAssignmentInputSchema.parse({ role_id: 4, scope: { kind: 'project', id: 9 } })).toThrow()
  })

  it('parses role references and assignments with exact discriminators', () => {
    expect(RoleRefSchema.parse(ROLE)).toEqual(ROLE)
    expect(RoleAssignmentSchema.parse(ASSIGNMENT)).toEqual(ASSIGNMENT)
    expect(MeRoleSchema.parse({ ...ROLE, source: 'assignment' })).toMatchObject({ key: 'hr_manager', source: 'assignment' })
    expect(MeRoleSchema.parse({ id: null, key: 'project_creation_policy', name: { ar: 'سياسة إنشاء المشاريع', en: 'Project creation policy' }, type: 'contextual', protected: false, source: 'policy' })).toMatchObject({ id: null, source: 'policy' })
    expect(() => RoleRefSchema.parse({ ...ROLE, id: 4, extra: true })).toThrow()
    expect(() => RoleRefSchema.parse({ ...ROLE, type: 'contextual', id: 4 })).toThrow()
  })
})

describe('admin user schemas', () => {
  it('accepts summary/detail shapes and preserves the res.users id', () => {
    expect(EmployeeAccountCandidateListSchema.parse({ items: [{ id: 31, name: 'سارة محمد', department: EMPLOYEE.department, work_email: 'sara@example.com', active: true, user_id: null, access_active: null }], total: 1 }).items[0]?.id).toBe(31)
    expect(AdminUserSummarySchema.parse(USER_SUMMARY).id).toBe(18)
    const { employee: _employee, ...withoutEmployee } = USER_SUMMARY
    expect(AdminUserSummarySchema.parse(withoutEmployee).employee).toBeUndefined()
    expect(AdminUserSummarySchema.parse({ ...USER_SUMMARY, employee: null }).employee).toBeNull()
    expect(AdminUserDetailSchema.parse(USER_DETAIL).capabilities[0]?.key).toBe('hr.employees.archive')
    expect(AdminUserListSchema.parse({ items: [USER_SUMMARY], total: 1 })).toMatchObject({ total: 1 })
  })

  it('rejects bare arrays and malformed list envelopes', () => {
    expect(() => AdminUserListSchema.parse([USER_SUMMARY])).toThrow()
    expect(() => AdminUserListSchema.parse({ items: [USER_SUMMARY] })).toThrow()
    expect(() => AdminUserListSchema.parse({ items: [USER_SUMMARY], total: 1, next: 2 })).toThrow()
    expect(() => AdminUserSummarySchema.parse({ ...USER_SUMMARY, password: 'secret-password' })).toThrow()
    expect(() => AdminUserDetailSchema.parse({ ...USER_DETAIL, session_id: 'session' })).toThrow()
  })

  it('keeps effective capability sources explicit and exact', () => {
    const parsed = EffectiveCapabilitySchema.parse(USER_DETAIL.capabilities[0])
    expect(parsed.sources[0]).toMatchObject({ role_assignment_id: 44, source: 'assignment' })
    expect(() => EffectiveCapabilitySchema.parse({ ...parsed, key: 'Not.A.Capability' })).toThrow()
    expect(EffectiveCapabilitySchema.parse({ ...parsed, key: 'sales.orders.write' }).key).toBe('sales.orders.write')
  })
})

describe('role and permission schemas', () => {
  const roleSummary = {
    id: 12,
    key: 'project_coordinator',
    name: { ar: 'منسق مشاريع', en: 'Project coordinator' },
    description: 'قراءة المشاريع وكتابة مهامها',
    type: 'custom' as const,
    active: true,
    protected: false,
    assignable: true,
    user_count: 2,
    version: 'r12-v3',
  }

  it('accepts built-in and custom role summaries/details', () => {
    expect(RoleSummarySchema.parse(roleSummary).type).toBe('custom')
    expect(RoleSummarySchema.parse({ ...roleSummary, active: false }).active).toBe(false)
    expect(RoleListSchema.parse({ items: [roleSummary], total: 1 }).items).toHaveLength(1)
    const detail = RoleDetailSchema.parse({
      ...roleSummary,
      permissions: ['pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.write'],
      allowed_actions: ['read', 'edit', 'disable', 'enable', 'delete', 'clone'],
    })
    expect(detail.permissions).toContain('pmo.tasks.write')
    expect(detail.allowed_actions).toContain('clone')
  })

  it('accepts the 25 item catalog and validates contextual scope metadata', () => {
    const definition = {
      key: 'pmo.projects.manage' as const,
      domain: 'pmo' as const,
      resource: 'projects',
      action: 'manage',
      label: { ar: 'إدارة المشاريع', en: 'Manage projects' },
      description: { ar: 'إدارة المشروع', en: 'Manage a project' },
      dependencies: ['pmo.projects.read' as const],
      scopes: [
        { kind: 'company' as const, assignable: true },
        { kind: 'project' as const, assignable: false },
      ],
      custom_role_allowed: true,
      sensitive: false,
    }
    expect(PermissionDefinitionSchema.parse(definition).scopes).toHaveLength(2)
    expect(PermissionCatalogSchema.parse({ items: [definition], total: 25, version: 'access-catalog-v1' }).total).toBe(25)
    expect(() => PermissionDefinitionSchema.parse({ ...definition, scopes: [{ kind: 'project', assignable: true }] })).toThrow()
    expect(() => RoleListSchema.parse([roleSummary])).toThrow()
    expect(() => RoleListSchema.parse({ items: [roleSummary], total: 1, extra: true })).toThrow()
  })

  it("accepts a newer application's permission with its own domain", () => {
    const sales = {
      key: 'sales.orders.write',
      domain: 'sales',
      resource: 'orders',
      action: 'write',
      label: { ar: 'تعديل طلبات البيع', en: 'Edit sales orders' },
      description: { ar: 'تعديل طلبات البيع', en: 'Edit sales orders' },
      dependencies: ['sales.orders.read'],
      scopes: [{ kind: 'company' as const, assignable: true }],
      custom_role_allowed: true,
      sensitive: false,
    }
    expect(PermissionCatalogSchema.parse({ items: [sales], total: 1, version: 'access-catalog-v1' }).items[0]).toEqual(sales)
    expect(KNOWN_PERMISSION_DOMAINS).toEqual(['access', 'hr', 'pmo', 'meetings', 'settings', 'documents'])
    for (const domain of ['Sales', 'sales-orders', 'sales.orders', '9sales', '']) {
      expect(() => PermissionDefinitionSchema.parse({ ...sales, domain })).toThrow()
    }
    expect(() => PermissionDefinitionSchema.parse({ ...sales, scopes: [...sales.scopes, { kind: 'project', assignable: false }] })).toThrow()
    expect(RoleDetailSchema.parse({ ...roleSummary, permissions: ['sales.orders.read', 'sales.orders.write'], allowed_actions: ['read'] }).permissions)
      .toEqual(['sales.orders.read', 'sales.orders.write'])
    expect(RoleCreateInputSchema.parse({ name: { ar: 'مبيعات', en: null }, description: '', permissions: ['sales.orders.read'] }).permissions)
      .toEqual(['sales.orders.read'])
    expect(() => RoleCreateInputSchema.parse({ name: { ar: 'مبيعات', en: null }, description: '', permissions: ['access.users.grant'] })).toThrow()
  })

  it('rejects access-changing permissions in custom role catalog entries', () => {
    const accessChanging = ['access.users.grant', 'access.users.assign_roles', 'access.users.disable', 'access.users.reset_password', 'access.roles.manage'] as const
    for (const key of accessChanging) {
      expect(() => PermissionDefinitionSchema.parse({
        key,
        domain: key.startsWith('access.') ? 'access' : 'access',
        resource: 'users',
        action: 'manage',
        label: { ar: 'صلاحية', en: 'Permission' },
        description: { ar: 'وصف', en: 'Description' },
        dependencies: [],
        scopes: [{ kind: 'company', assignable: true }],
        custom_role_allowed: true,
        sensitive: true,
      })).toThrow()
    }
  })
})

describe('admin input schemas and fail-closed security fields', () => {
  it('keeps the exact grant/reset passwords and requires expected versions where specified', () => {
    expect(GrantAccountInputSchema.parse({
      name: ' سارة محمد ',
      login: 'sara@example.com',
      password: '  12345678  ',
      assignments: [{ role_id: 1, scope: { kind: 'company', id: 1 } }],
    })).toMatchObject({ name: 'سارة محمد', password: '  12345678  ' })
    expect(EmployeeAccountInputSchema.parse({
      employee_id: 31,
      password: '  12345678  ',
      assignments: [{ role_id: 1, scope: { kind: 'company', id: 1 } }],
    }).password).toBe('  12345678  ')
    expect(UpdateUserAccessInputSchema.parse({
      assignments: [{ role_id: 4, scope: { kind: 'company', id: 1 } }],
      expected_version: 'u18-a3-v7',
    }).expected_version).toBe('u18-a3-v7')
    expect(ResetPasswordInputSchema.parse({ password: '  12345678 ', expected_version: 'u18-a3-v7' }).password).toBe('  12345678 ')
    expect(() => GrantAccountInputSchema.parse({ name: 'سارة', login: 'sara@example.com', password: 'short', assignments: [] })).toThrow()
    expect(() => GrantAccountInputSchema.parse({ name: 'سارة', login: 'not-an-email', password: '12345678', assignments: [{ role_id: 1, scope: { kind: 'company', id: 1 } }] })).toThrow()
    expect(() => GrantAccountInputSchema.parse({ employee_id: 31, password: '12345678', assignments: [{ role_id: 1, scope: { kind: 'company', id: 1 } }] })).toThrow()
    expect(() => EmployeeAccountInputSchema.parse({ employee_id: 31, password: 'short', assignments: [] })).toThrow()
    expect(() => UpdateUserAccessInputSchema.parse({ assignments: [], expected_version: 'v1' })).toThrow()
    expect(() => ResetPasswordInputSchema.parse({ password: '12345678' })).toThrow()
  })

  it('accepts an optional exact password for reactivation and validates state bodies strictly', () => {
    expect(ChangeUserStateInputSchema.parse({ expected_version: 'u18-a3-v7' })).toEqual({ expected_version: 'u18-a3-v7' })
    expect(ChangeUserStateInputSchema.parse({ expected_version: 'u18-a3-v7', password: '  secret-password  ' }).password).toBe('  secret-password  ')
    expect(() => ChangeUserStateInputSchema.parse({ expected_version: 'u18-a3-v7', session_id: 'session' })).toThrow()
  })

  it('rejects sensitive keys in audit values and never accepts password output fields', () => {
    expect(AuditActionSchema.options).toEqual([
      'user.granted',
      'user.employee_linked',
      'user.roles_changed',
      'user.disabled',
      'user.reactivated',
      'user.password_reset',
      'employee.archived_access_disabled',
      'role.created',
      'role.updated',
      'role.disabled',
      'role.enabled',
      'role.deleted',
      'migration.legacy_admin_preserved',
    ])
    expect(AuditActionSchema.parse('user.password_reset')).toBe('user.password_reset')
    expect(AccessAuditSummarySchema.parse(AUDIT_SUMMARY).result).toBe('succeeded')
    expect(AccessAuditListSchema.parse({ items: [AUDIT_SUMMARY], total: 1 }).items).toHaveLength(1)
    expect(AccessAuditDetailSchema.parse({
      ...AUDIT_SUMMARY,
      before: { assignments: [] },
      after: { sessions_revoked: true },
      reason: null,
    }).after).toEqual({ sessions_revoked: true })
    expect(() => AccessAuditDetailSchema.parse({
      ...AUDIT_SUMMARY,
      before: { password: 'secret-password' },
      after: null,
      reason: null,
    })).toThrow()
    expect(() => AccessAuditDetailSchema.parse({ ...AUDIT_SUMMARY, before: { token: 'x' }, after: null, reason: null })).toThrow()
    expect(() => AccessAuditListSchema.parse([AUDIT_SUMMARY])).toThrow()
  })
})
