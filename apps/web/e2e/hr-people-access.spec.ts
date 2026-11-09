import { test, expect, type Page } from '@playwright/test'
import { AdminUserDetailSchema, HrEmployeeSchema, MeSchema, RoleListSchema } from '@liwan/contracts'
import { acceptInvitation, MAIL_OUTBOX } from './support/mailOutbox'
import { ACCEPTANCE_ORIGIN, signIn } from './support/realOdooSession'

// Runs only on the isolated real-Odoo stack (deploy/ci/e2e-odoo.sh). The steps where the invited employee signs in need
// the emailed link, so they run only with E2E_MAIL_OUTBOX (the stage sets none, so they skip); the archive, unarchive
// and reactivation steps need no mail.
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only')
test.beforeEach(async ({}, info) => { expect(new URL(String(info.project.use.baseURL)).origin).toBe(ACCEPTANCE_ORIGIN) })

const DAY_MS = 86_400_000
/** An ISO date DAYS before today: the leaver's contract start and a departure date that has already come. */
const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10)

/**
 * Records the employee's departure, which archiving requires while the tenant enables `hr.offboarding`: a fresh
 * employee is refused with 422 `departure_missing` (odoo-addons/liwan_hr/models/hr_employee.py:273-276), and
 * `departure_date` itself is not writable through PATCH /hr/employees, so the supported path is the departure register.
 * A past date is the point: a future one is refused with `departure_future` until the day it names.
 */
async function registerDeparture(page: Page, employeeId: number) {
  const started = await page.request.patch(`/api/v1/hr/employees/${employeeId}`, { data: { contract: { start_date: isoDaysAgo(5 * 365) } } })
  expect(started.status(), await started.text()).toBe(200)
  const reasons = (await (await page.request.get('/api/v1/hr/offboarding/reasons')).json()).items as { id: number }[]
  const departure = await page.request.post('/api/v1/hr/offboarding/departures', {
    data: { employee_id: employeeId, departure_date: isoDaysAgo(365), departure_reason_id: reasons[0]!.id },
  })
  expect(departure.status(), await departure.text()).toBe(201)
}

/**
 * Records the leaver's end-of-service settlement, which archiving requires while the tenant enables `hr.payroll`
 * (odoo-addons/liwan_hr/models/hr_employee.py:297-304). A payroll officer records the compensation and confirms the
 * settlement; the fixture seeds one so no other journey's account changes roles.
 */
async function confirmSettlement(page: Page, employeeId: number) {
  await signIn(page, 'payroll_officer')
  const compensation = await page.request.put(`/api/v1/hr/payroll/compensation/${employeeId}`, {
    data: {
      basic_wage: 9000, housing_allowance: 2250, transport_allowance: 450, other_allowance: 0,
      iban: null, bank_id: null, gosi_number: null, gosi_registration_date: null, relationship_type: 'employee',
    },
  })
  expect(compensation.status(), await compensation.text()).toBe(200)
  const settlement = await page.request.put(`/api/v1/hr/payroll/eos/${employeeId}/settlement`, { data: { case: 'resignation', open_deductions: 0 } })
  expect(settlement.status(), await settlement.text()).toBe(200)
  const confirmed = await page.request.post(`/api/v1/hr/payroll/eos/${employeeId}/settlement/confirm`, { data: {} })
  expect(confirmed.status(), await confirmed.text()).toBe(200)
  expect((await confirmed.json()).state).toBe('confirmed')
  await signIn(page)
}

test('HR archival disables linked access and unarchival requires explicit account reactivation', async ({ page, browser }) => {
  await signIn(page)
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = `hr-lifecycle-${suffix}@example.test`
  const password = `LiwanOS-lifecycle-${suffix}`
  const employeeRes = await page.request.post('/api/v1/hr/employees', { data: { name: `موظف دورة ${suffix}`, work_email: email } })
  expect(employeeRes.status()).toBe(201)
  const employee = HrEmployeeSchema.parse(await employeeRes.json())
  const me = MeSchema.parse(await (await page.request.get('/api/v1/me')).json())
  const roles = RoleListSchema.parse(await (await page.request.get('/api/v1/admin/roles')).json())
  const role = roles.items.find(item => item.key === 'employee')!
  // The grant needs the login it invites (the route moved from a typed password to an emailed invitation).
  const grant = await page.request.post('/api/v1/admin/employee-accounts', { data: { employee_id: employee.id, login: email, assignments: [{ role_id: role.id, scope: { kind: 'company', id: me.company.id } }] } })
  expect(grant.status()).toBe(201)
  const account = AdminUserDetailSchema.parse(await grant.json())
  if (MAIL_OUTBOX) await acceptInvitation(page.request, email, password)
  const employeeContext = await browser.newContext({ baseURL: ACCEPTANCE_ORIGIN })
  try {
    if (MAIL_OUTBOX) {
      expect((await employeeContext.request.post('/api/auth/login', { data: { login: email, password } })).status()).toBe(200)
      expect(MeSchema.parse(await (await employeeContext.request.get('/api/v1/me')).json()).id).toBe(account.id)
    }
    // Archiving runs the exit check of every sub-feature the tenant enables, so the journey satisfies the ones this
    // tenant includes before it presses the page's own archive action.
    if (me.entitlements['hr.offboarding'] === true) await registerDeparture(page, employee.id)
    if (me.entitlements['hr.payroll'] === true) await confirmSettlement(page, employee.id)
    const changed = await page.request.patch(`/api/v1/hr/employees/${employee.id}`, { data: { work_email: `changed-${email}` } })
    expect(changed.status()).toBe(200)
    expect(AdminUserDetailSchema.parse(await (await page.request.get(`/api/v1/admin/users/${account.id}`)).json()).login).toBe(email)
    await page.goto(`/hr/employees/${employee.id}`)
    // Archiving is the employee page's overflow-menu action and it confirms inline, never in a dialog
    // (apps/web/app/pages/hr/employees/[employeeId].vue:45-92).
    await page.getByRole('button', { name: `إجراءات الموظف ${employee.name}`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'أرشفة الموظف', exact: true }).click()
    await page.getByTestId('inline-confirm-action').click()
    await expect.poll(async () => HrEmployeeSchema.parse(await (await page.request.get(`/api/v1/hr/employees/${employee.id}`)).json()).active).toBe(false)
    const archived = HrEmployeeSchema.parse(await (await page.request.get(`/api/v1/hr/employees/${employee.id}`)).json())
    expect(archived.access).toMatchObject({ user_id: account.id, active: false })
    if (MAIL_OUTBOX) expect((await employeeContext.request.get('/api/v1/me')).status()).toBe(403)
    const unarchive = await page.request.post(`/api/v1/hr/employees/${employee.id}/unarchive`, { data: {} })
    expect(unarchive.status()).toBe(200)
    expect(HrEmployeeSchema.parse(await unarchive.json())).toMatchObject({ active: true, access: { active: false } })
    const disabled = AdminUserDetailSchema.parse(await (await page.request.get(`/api/v1/admin/users/${account.id}`)).json())
    const reactivate = await page.request.post(`/api/v1/admin/users/${account.id}/reactivate`, { data: { expected_version: disabled.version } })
    expect(reactivate.status()).toBe(200)
    expect(AdminUserDetailSchema.parse(await reactivate.json()).active).toBe(true)
    if (MAIL_OUTBOX) {
      expect((await employeeContext.request.get('/api/v1/me')).status()).toBe(403)
      expect((await employeeContext.request.post('/api/auth/login', { data: { login: email, password } })).status()).toBe(200)
      expect(MeSchema.parse(await (await employeeContext.request.get('/api/v1/me')).json()).id).toBe(account.id)
    }
    await expect(page.getByRole('dialog')).toHaveCount(0)
  } finally { await employeeContext.close() }
})
