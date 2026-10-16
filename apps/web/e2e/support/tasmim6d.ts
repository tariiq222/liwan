import {
  AccessAuditDetailSchema, AccessAuditListSchema, AdminUserDetailSchema, AdminUserListSchema,
  PermissionCatalogSchema, RoleDetailSchema, RoleListSchema,
} from '@webvue/contracts'
import { expect, type Page } from '@playwright/test'

// Shared by the Plan 6d specs (tasmim6-*.spec.ts for settings, account and the standalone pages).
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'

export async function loginAdmin(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}

export async function openShell(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}

// The server renders a first load and fetches its data itself, so a browser route cannot intercept it:
// open /projects first and move to `path` client-side, where the browser makes the requests.
// Relies on the dev-only window.useNuxtApp, so it runs only against `nuxt dev`.
export async function openClientSide(page: Page, path: string) {
  await openShell(page, '/projects')
  await page.evaluate(
    target => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push(target),
    path,
  )
}

export const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

const COMPANY = { kind: 'company', id: 1, name: 'ويب فيو' } as const
const roleRef = (id: number, key: string, ar: string, en: string, type: 'built_in' | 'custom' = 'built_in') =>
  ({ id, key, name: { ar, en }, type, protected: false })
export const ROLE_REFS = {
  admin: roleRef(1, 'system_admin', 'مدير النظام', 'System admin'),
  pmo: roleRef(2, 'pmo_manager', 'مدير المشاريع', 'PMO manager'),
  custom: roleRef(3, 'reviewer', 'مراجع', 'Reviewer', 'custom'),
}

const user = (id: number, name: string, login: string, roles: typeof ROLE_REFS[keyof typeof ROLE_REFS][], active = true) => ({
  id, name, login, active, protected: false, version: `u${id}`,
  employee: id === 13 ? null : { id: id - 6, name, department: null },
  assignments: roles.map((role, index) => ({ id: id * 10 + index + 1, role, scope: COMPANY })),
})
export const USERS = AdminUserListSchema.parse({
  items: [user(11, 'سارة محمد', 'sara', [ROLE_REFS.pmo]), user(12, 'نورة الحربي', 'noura', [ROLE_REFS.custom]), user(13, 'خالد العتيبي', 'khalid', [], false)],
  total: 3,
})
export const USER_DETAIL = AdminUserDetailSchema.parse({
  ...USERS.items[0],
  capabilities: [{ key: 'pmo.projects.read', sources: [{ role_assignment_id: 111, role: ROLE_REFS.pmo, scope: COMPANY, source: 'assignment' }] }],
  allowed_actions: ['read', 'assign_roles', 'reset_password', 'disable'],
})

const role = (ref: typeof ROLE_REFS[keyof typeof ROLE_REFS], description: string, userCount: number) => ({
  id: ref.id, key: ref.key, name: ref.name, description, type: ref.type, active: true, protected: false,
  assignable: true, user_count: userCount, version: `r${ref.id}`,
})
export const ROLES = RoleListSchema.parse({
  items: [role(ROLE_REFS.admin, '', 1), role(ROLE_REFS.pmo, '', 1), role(ROLE_REFS.custom, 'دور مخصص للمراجعة', 1)],
  total: 3,
})
export const ROLE_DETAIL = RoleDetailSchema.parse({
  ...ROLES.items[2], permissions: ['pmo.projects.read'], allowed_actions: ['read', 'edit', 'clone', 'disable', 'delete'],
})
export const CATALOG = PermissionCatalogSchema.parse({
  version: 'p',
  total: 2,
  items: ['pmo.projects.read', 'pmo.tasks.read'].map(key => ({
    key, domain: 'pmo', resource: key.split('.')[1], action: 'read',
    label: { ar: key === 'pmo.projects.read' ? 'عرض المشاريع' : 'عرض المهام', en: key },
    description: { ar: 'وصف الصلاحية', en: 'Permission' },
    dependencies: [], scopes: [{ kind: 'company', assignable: true }], custom_role_allowed: true, sensitive: false,
  })),
})

const event = (id: number, action: string, targetType: 'user' | 'role', targetId: number, targetName: string) => ({
  id, occurred_at: `2026-10-0${id - 30}T10:00:00+00:00`, action, result: 'succeeded',
  actor: { id: 2, name: 'Admin', login: 'admin' }, target: { type: targetType, id: targetId, name: targetName },
})
export const AUDIT = AccessAuditListSchema.parse({
  items: [event(31, 'user.granted', 'user', 11, 'سارة محمد'), event(32, 'role.created', 'role', 3, 'مراجع'), event(33, 'user.disabled', 'user', 13, 'خالد العتيبي')],
  total: 3,
})
export const AUDIT_DETAIL = AccessAuditDetailSchema.parse({ ...AUDIT.items[0], before: null, after: { active: true }, reason: null })

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
const notFound = () => json({ code: 'not_found', message: 'not found' }, 404)

// Fulfils the admin API in the browser (GET only; anything else continues to the mock).
export async function mockAdminApi(page: Page) {
  await page.route('**/api/v1/admin/**', async (route) => {
    const request = route.request()
    if (request.method() !== 'GET') return route.continue()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api/v1/admin', '')
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    if (path === '/users') {
      const items = USERS.items.filter(item => !q || item.name.toLowerCase().includes(q) || item.login.includes(q))
      return route.fulfill(json({ items, total: items.length }))
    }
    const userId = path.match(/^\/users\/(\d+)$/)
    if (userId) return route.fulfill(userId[1] === '11' ? json(USER_DETAIL) : notFound())
    if (path === '/roles') {
      const items = ROLES.items.filter(item => !q || item.name.ar.includes(q) || (item.name.en ?? '').toLowerCase().includes(q))
      return route.fulfill(json({ items, total: items.length }))
    }
    const roleId = path.match(/^\/roles\/(\d+)$/)
    if (roleId) return route.fulfill(roleId[1] === '3' ? json(ROLE_DETAIL) : notFound())
    if (path === '/permissions') return route.fulfill(json(CATALOG))
    if (path === '/access-log') return route.fulfill(json(AUDIT))
    const eventId = path.match(/^\/access-log\/(\d+)$/)
    if (eventId) return route.fulfill(eventId[1] === '31' ? json(AUDIT_DETAIL) : notFound())
    return route.continue()
  })
}
