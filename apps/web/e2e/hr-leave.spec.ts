import { test, expect, type Page } from '@playwright/test'

// Needs two users the scratch fixture creates through Odoo: `staff` (employee role, an annual
// balance of 21 days) and `hrmgr` (HR manager role), both in a Saudi company.
const STAFF = { login: process.env.E2E_LEAVE_STAFF ?? 'staff', password: process.env.E2E_LEAVE_STAFF_PASSWORD ?? 'staff_pass_123' }
const MANAGER = { login: process.env.E2E_LEAVE_MANAGER ?? 'hrmgr', password: process.env.E2E_LEAVE_MANAGER_PASSWORD ?? 'hrmgr_pass_123' }

async function login(page: Page, user: { login: string; password: string }) {
  await page.context().clearCookies()
  await page.goto('/login')
  // Controls stay disabled until hydration (useHydrated); wait for the real button.
  await expect(page.getByRole('button', { name: 'دخول' })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill(user.login)
  await page.getByLabel('كلمة المرور').fill(user.password)
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

const iso = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`

// A Monday–Thursday of next month (a working day in both the Saudi Sunday–Thursday week and
// Odoo's default Monday–Friday calendar) that none of the employee's open or approved
// requests covers, so a rerun on a reused database does not hit hr_holidays' overlap refusal.
async function freeWorkingDay(page: Page) {
  const body = await (await page.request.get('/api/v1/hr/leave/requests?mine=1&limit=200')).json()
  const taken = new Set<string>()
  for (const item of body.items as Array<{ date_from: string; date_to: string; state: string }>) {
    if (item.state === 'refuse' || item.state === 'cancel') continue
    for (let d = new Date(`${item.date_from}T00:00:00`); iso(d) <= item.date_to; d.setDate(d.getDate() + 1)) taken.add(iso(d))
  }
  const day = new Date()
  day.setMonth(day.getMonth() + 1, 1)
  const month = day.getMonth()
  while (day.getMonth() === month && (day.getDay() === 0 || day.getDay() === 5 || day.getDay() === 6 || taken.has(iso(day)))) day.setDate(day.getDate() + 1)
  if (day.getMonth() !== month) throw new Error('no free working day next month')
  return day
}

// "الاثنين، 9 نوفمبر 2026": the calendar's accessible name of a day.
function calendarLabel(day: Date) {
  const weekday = new Intl.DateTimeFormat('ar', { weekday: 'long' }).format(day)
  const month = new Intl.DateTimeFormat('ar', { month: 'long' }).format(day)
  return `${weekday}، ${day.getDate()} ${month} ${day.getFullYear()}`
}

// The table row of one request, found through its record number cell.
function leaveRow(page: Page, id: number) {
  return page.getByRole('row').filter({ has: page.getByTestId(`hr-leave-row-${id}`) })
}

// The remaining days of the balance-holding type the test requests (the first one the employee holds).
async function annualRemaining(page: Page, typeId?: number) {
  const body = await (await page.request.get('/api/v1/hr/leave/balances')).json()
  const items = body.items as Array<{ leave_type: { id: number }; remaining: number }>
  return (typeId ? items.find(item => item.leave_type.id === typeId) : items[0])?.remaining
}

test('an employee requests leave and a manager approves and administratively cancels it', async ({ page }) => {
  await login(page, STAFF)
  await page.goto('/account/leave')
  await expect(page.getByRole('heading', { level: 1, name: 'الإجازات' })).toBeVisible()
  await expect(page.getByTestId('hr-leave-balances')).toBeVisible()
  // An employee sees no approver scopes and no grant action.
  await expect(page.getByTestId('hr-leave-scope-pending')).toHaveCount(0)
  await expect(page.getByTestId('hr-leave-allocate')).toHaveCount(0)
  const before = await annualRemaining(page)
  expect(before).toBeGreaterThan(0)

  // The create panel opens over the list from its own route.
  await expect(page.getByTestId('hr-leave-scope-mine').or(page.getByTestId('hr-leave-balances'))).toBeVisible()
  await page.waitForFunction(() => !document.querySelector('[data-testid="hr-leave-balances"] [aria-busy="true"]'))
  await expect(page.getByTestId('hr-leave-new')).not.toHaveAttribute('aria-disabled', 'true')
  await page.getByTestId('hr-leave-new').click()
  await expect(page).toHaveURL(/\/account\/leave\/new(?:\?|$)/)
  const panel = page.getByRole('dialog')
  await expect(panel.getByRole('heading', { name: 'طلب إجازة' })).toBeVisible()

  // Required-field validation stays in the panel.
  await panel.getByTestId('hr-leave-submit').click()
  await expect(panel.getByText('نوع الإجازة مطلوب.')).toBeVisible()

  // Fill the form through the real controls: the type menu, then one day in next month's calendar.
  const balances = (await (await page.request.get('/api/v1/hr/leave/balances')).json()).items as Array<{ leave_type: { id: number; name: string } }>
  const annual = balances[0]!.leave_type
  await panel.getByTestId('hr-leave-type').click()
  await page.getByRole('option', { name: annual.name }).click()
  await panel.getByTestId('hr-leave-from').click()
  await page.getByRole('button', { name: 'الشهر المقبل' }).click()
  const day = await freeWorkingDay(page)
  await page.getByRole('button', { name: calendarLabel(day), exact: true }).click()
  await page.keyboard.press('Escape')
  // Picking the start fills the end with the same day; the request is one calendar day.
  await expect(panel.getByTestId('hr-leave-to')).not.toHaveText(/اختر تاريخ|Select a date/)
  await panel.getByLabel('ملاحظات').fill('E2E')
  const posted = page.waitForResponse(response => response.url().endsWith('/api/v1/hr/leave/requests') && response.request().method() === 'POST')
  await panel.getByTestId('hr-leave-submit').click()
  const createdResponse = await posted
  expect(createdResponse.status()).toBe(201)
  const leave = await createdResponse.json()
  expect(leave.state).toBe('confirm')
  expect(leave.date_from).toBe(iso(day))
  expect(leave.date_to).toBe(iso(day))
  expect(leave.number_of_days).toBe(1)
  // Saving closes the panel back to the list.
  await expect(page).toHaveURL(/\/account\/leave(?:\?|$)/)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.goto('/account/leave')
  const row = leaveRow(page, leave.id)
  await expect(row.getByTestId('hr-leave-state')).toHaveText('بانتظار الاعتماد')
  expect(await annualRemaining(page, annual.id)).toBe(before - 1)
  await row.getByRole('link', { name: annual.name }).click()
  await expect(page).toHaveURL(new RegExp(`/account/leave/${leave.id}\\?returnTo=`))
  await page.reload()
  await expect(page.getByTestId('hr-leave-record-approve')).toHaveCount(0)
  expect((await page.request.get(`/api/v1/hr/leave/me/${leave.id}`)).status()).toBe(200)

  // The employee cannot approve through the API either.
  const forbidden = await page.request.post(`/api/v1/hr/leave/requests/${leave.id}/approve`, { data: {} })
  expect(forbidden.status()).toBe(403)

  // An HR manager's Self-service remains their own list, even with a forged management scope.
  await login(page, MANAGER)
  await page.goto('/account/leave?scope=all&employee_id=999')
  await expect(page.getByTestId('hr-leave-scope-pending')).toHaveCount(0)
  await expect(page.getByTestId(`hr-leave-row-${leave.id}`)).toHaveCount(0)
  // The manager approves from the pending queue.
  await login(page, MANAGER)
  await page.goto('/hr/leave?scope=pending')
  await expect(page.getByTestId('hr-leave-scope-pending')).toBeVisible()
  await expect(page.getByTestId('hr-leave-allocate')).toBeVisible()
  const pendingRow = leaveRow(page, leave.id)
  await expect(pendingRow).toBeVisible()
  await pendingRow.getByTestId('row-actions-menu').click()
  const approved = page.waitForResponse(response => response.url().endsWith(`/api/v1/hr/leave/requests/${leave.id}/approve`))
  await page.getByRole('menuitem', { name: 'اعتماد' }).click()
  expect((await approved).status()).toBe(200)
  // Approved requests leave the pending queue once the list refetches; the full list shows them approved.
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.getByTestId(`hr-leave-row-${leave.id}`)).toHaveCount(0)
  await page.goto('/hr/leave?scope=all')
  await expect(leaveRow(page, leave.id).getByTestId('hr-leave-state')).toHaveText('معتمدة')
  // The scope survives a refresh.
  await page.reload()
  await expect(page).toHaveURL(/scope=all/)

  // The employee sees their approved request without administrative cancellation.
  await login(page, STAFF)
  await page.goto('/account/leave')
  await expect(leaveRow(page, leave.id).getByTestId('hr-leave-state')).toHaveText('معتمدة')
  await expect(leaveRow(page, leave.id).getByTestId('row-actions-menu')).toHaveCount(0)

  // Administrative cancellation stays in HR and asks inline before changing the balance.
  await login(page, MANAGER)
  await page.goto('/hr/leave?scope=all')
  await leaveRow(page, leave.id).getByTestId('row-actions-menu').click()
  await page.getByRole('menuitem', { name: 'إلغاء الإجازة' }).click()
  const cancelled = page.waitForResponse(response => response.url().endsWith(`/api/v1/hr/leave/requests/${leave.id}/cancel`))
  await page.getByRole('button', { name: 'إلغاء الإجازة' }).last().click()
  expect((await cancelled).status()).toBe(200)
  await login(page, STAFF)
  await page.goto('/account/leave')
  await expect(leaveRow(page, leave.id).getByTestId('hr-leave-state')).toHaveText('ملغاة')
  expect(await annualRemaining(page)).toBe(before)
})

test('an employee withdraws a request that is still waiting for a decision', async ({ page }) => {
  await login(page, STAFF)
  const started = await (await page.request.get('/api/v1/hr/leave/balances')).json() as { items: Array<{ leave_type: { id: number; name: string }; pending: number }> }
  const annual = started.items[0]!.leave_type
  const day = await freeWorkingDay(page)
  const created = await page.request.post('/api/v1/hr/leave/requests', {
    data: { leave_type_id: annual.id, date_from: iso(day), date_to: iso(day) },
  })
  expect(created.status()).toBe(201)
  const leave = await created.json()

  await page.goto('/account/leave')
  const row = leaveRow(page, leave.id)
  await expect(row.getByTestId('hr-leave-state')).toHaveText('بانتظار الاعتماد')
  await row.getByTestId('row-actions-menu').click()
  await page.getByRole('menuitem', { name: 'سحب الطلب' }).click()
  // Withdrawing deletes the request, so it asks first.
  const withdrawn = page.waitForResponse(response => response.url().endsWith(`/api/v1/hr/leave/requests/${leave.id}/cancel`))
  await page.getByRole('button', { name: 'سحب الطلب' }).last().click()
  expect((await withdrawn).status()).toBe(200)
  // The request is gone and its day is no longer held against the balance.
  await expect(page.getByTestId(`hr-leave-row-${leave.id}`)).toHaveCount(0)
  const after = await (await page.request.get('/api/v1/hr/leave/balances')).json() as { items: Array<{ pending: number }> }
  expect(after.items[0]!.pending).toBe(started.items[0]!.pending)
  const gone = await page.request.get(`/api/v1/hr/leave/requests/${leave.id}`)
  expect(gone.status()).toBe(404)
})

test('the grant panel is for leave managers only and grants a balance', async ({ page }) => {
  // An employee who opens the grant route directly gets the forbidden page, not the form.
  await login(page, STAFF)
  await page.goto('/hr/leave/allocations/new')
  await expect(page.getByRole('heading', { level: 1, name: 'لا تملك صلاحية فتح هذه الصفحة' })).toBeVisible()
  await expect(page.getByTestId('hr-leave-allocation-form')).toHaveCount(0)

  await login(page, MANAGER)
  await page.goto('/hr/leave')
  await page.getByTestId('hr-leave-allocate').click()
  await expect(page).toHaveURL(/\/hr\/leave\/allocations\/new(?:\?|$)/)
  const panel = page.getByRole('dialog')
  await expect(panel.getByRole('heading', { name: 'منح رصيد' })).toBeVisible()
  await panel.getByTestId('hr-allocation-submit').click()
  await expect(panel.getByText('الموظف مطلوب.')).toBeVisible()
  await panel.getByTestId('hr-allocation-employee').click()
  await page.getByRole('option', { name: 'سالم الموظف' }).click()
  await panel.getByTestId('hr-allocation-type').click()
  await page.getByRole('option').first().click()
  await panel.locator('#hr-allocation-days').fill('5')
  const granted = page.waitForResponse(response => response.url().endsWith('/api/v1/hr/leave/allocations') && response.request().method() === 'POST')
  await panel.getByTestId('hr-allocation-submit').click()
  const grantedResponse = await granted
  expect(grantedResponse.status()).toBe(201)
  expect((await grantedResponse.json()).state).toBe('validate')
  await expect(page).toHaveURL(/\/hr\/leave(?:\?|$)/)

  // Escape closes a reopened panel back to the list without saving.
  await page.getByTestId('hr-leave-allocate').click()
  await expect(page).toHaveURL(/\/hr\/leave\/allocations\/new/)
  // Escape closes the panel back to the list.
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/hr\/leave(?:\?|$)/)
})
