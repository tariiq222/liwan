import { expect, test, type Page } from '@playwright/test'

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'

const FIELD_KEYS = [
  'name', 'code', 'description', 'type', 'owning_unit', 'sponsor', 'manager',
  'authority', 'rationale', 'objectives', 'benefits', 'scope', 'exclusions',
  'high_level_requirements', 'deliverables', 'acceptance', 'success',
  'date_start', 'date_end', 'budget_state', 'amount', 'currency', 'priority',
  'assumptions', 'constraints', 'closure',
]

async function login(page: Page) {
  await page.goto('/login')
  const submit = page.getByRole('button', { name: 'دخول' })
  await expect(submit).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill(ADMIN_LOGIN)
  await page.getByLabel('كلمة المرور').fill(ADMIN_PASSWORD)
  await submit.click()
  await expect(page).toHaveURL(/\/tasks$/)
}

async function openCreate(page: Page) {
  await page.goto('/projects/new')
  await expect(page.getByRole('heading', { name: 'مشروع جديد' })).toBeVisible()
  const help = page.getByTestId('field-help').first()
  await expect(help).toBeEnabled()
  return help
}

// The charter is a stepper: basics, then the steps the chosen classification
// configures (all of them when no type is chosen), then review.
const ALL_STEPS = ['basics', 'justification', 'scope', 'schedule', 'budget', 'risks', 'review'] as const
const STEP_FIELDS: Record<(typeof ALL_STEPS)[number], string[]> = {
  basics: ['name', 'code', 'description', 'type', 'owning_unit', 'manager', 'sponsor'],
  justification: ['authority', 'rationale', 'objectives', 'benefits'],
  scope: ['scope', 'exclusions', 'high_level_requirements', 'deliverables', 'acceptance', 'success'],
  schedule: ['date_start', 'date_end', 'priority'],
  budget: ['budget_state', 'amount', 'currency'],
  risks: ['assumptions', 'constraints', 'closure'],
  review: [],
}

async function nextStep(page: Page) {
  await page.getByTestId('charter-step-next').click()
}

async function goToStep(page: Page, target: (typeof ALL_STEPS)[number]) {
  await expect(page).toHaveURL(/step=/)
  while (!new URL(page.url()).searchParams.get('step')?.startsWith(target)) {
    const current = new URL(page.url()).searchParams.get('step') ?? 'basics'
    if (ALL_STEPS.indexOf(current as (typeof ALL_STEPS)[number]) < ALL_STEPS.indexOf(target)) await nextStep(page)
    else await page.getByTestId('charter-step-previous').click()
    await expect(page).not.toHaveURL(new RegExp(`step=${current}(&|$)`))
  }
}

test('create page shows every charter field and allows a name-only save', async ({ page }) => {
  await login(page)
  const before = await (await page.request.get('/api/v1/settings/projects')).json()
  const optional = await page.request.patch('/api/v1/settings/projects', {
    data: { require_manager_on_create: false, require_end_date_on_create: false },
  })
  expect(optional.status()).toBe(200)
  try {
    await page.goto('/projects/new')
    await expect(page.getByRole('heading', { name: 'مشروع جديد' })).toBeVisible()
    await expect(page.getByTestId('charter-stepper')).toBeVisible()
    const name = `E2E charter ${Date.now()}`
    await page.getByTestId('project-create-name').fill(name)
    const seen = new Set<string>()
    for (const step of ALL_STEPS) {
      for (const key of STEP_FIELDS[step]) {
        await expect(page.getByTestId(`charter-field-${key}`)).toBeVisible()
        seen.add(key)
      }
      if (step !== 'review') await nextStep(page)
    }
    expect([...seen].sort()).toEqual([...FIELD_KEYS].sort())
    await expect(page.getByTestId('charter-review-step')).toBeVisible()
    await page.getByTestId('project-create-submit').click()
    await expect(page.getByRole('heading', { name })).toBeVisible()
    const projectId = Number(new URL(page.url()).pathname.split('/')[2])
    const created = await (await page.request.get(`/api/v1/projects/${projectId}`)).json()
    expect(created.charter.state).toBe('final')
    await page.goto(`/projects/${projectId}/charter`)
    await expect(page).not.toHaveURL(/edit=1/)
    await expect(page.getByTestId('project-charter-form')).toBeVisible()
    await expect(page.getByTestId('charter-state-badge')).toHaveText('معتمد')
    await expect(page.getByRole('button', { name: 'حفظ' })).toHaveCount(0)
  }
  finally {
    await page.request.patch('/api/v1/settings/projects', {
      data: {
        require_manager_on_create: before.require_manager_on_create,
        require_end_date_on_create: before.require_end_date_on_create,
      },
    })
  }
})

test('charter help opens on hover and closes when the pointer leaves', async ({ page }) => {
  await login(page)
  const help = await openCreate(page)
  await help.hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.getByRole('heading', { name: 'مشروع جديد' }).hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
})

test('charter help opens on focus, toggles with Enter, and closes with Escape', async ({ page }) => {
  await login(page)
  const help = await openCreate(page)
  await help.focus()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
})

test('charter help stays open after a touch tap until outside or Escape', async ({ page }) => {
  await login(page)
  const help = await openCreate(page)
  await help.evaluate((el) => {
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true }))
  })
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.getByRole('heading', { name: 'مشروع جديد' }).click()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await help.evaluate((el) => {
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true }))
  })
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
})

test('creating a project keeps the list returnTo on the new record', async ({ page }) => {
  await login(page)
  await page.goto('/projects/new?returnTo=' + encodeURIComponent('/projects?q=charter-keep'))
  const name = `E2E charter return ${Date.now()}`
  await page.getByTestId('project-create-name').fill(name)
  await goToStep(page, 'schedule')
  await page.getByTestId('project-create-end-date').click()
  await page.locator('[data-slot="calendar-cell-trigger"]:not([data-outside-view])').nth(10).click()
  await goToStep(page, 'review')
  await page.getByTestId('project-create-submit').click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page).toHaveURL(/returnTo=/)
  await page.getByRole('link', { name: 'العودة إلى المشاريع' }).click()
  await expect(page).toHaveURL(/\/projects\?q=charter-keep/)
})

test('saving a draft mid-way creates the project and reopens its charter at the same step', async ({ page }) => {
  await login(page)
  await page.goto('/projects/new')
  const name = `E2E charter draft ${Date.now()}`
  await page.getByTestId('project-create-name').fill(name)
  await page.getByTestId('project-create-end-date').click()
  await page.locator('[data-slot="calendar-cell-trigger"]:not([data-outside-view])').nth(10).click()
  await goToStep(page, 'scope')
  await page.locator('#charter-scope').fill('نطاق أولي')
  await page.getByTestId('charter-save-draft').click()
  await expect(page).toHaveURL(/\/projects\/\d+\/charter\?.*edit=1/)
  await expect(page).toHaveURL(/step=scope/)
  await expect(page.locator('#charter-scope')).toHaveValue('نطاق أولي')
  const projectId = Number(new URL(page.url()).pathname.split('/')[2])
  const drafted = await (await page.request.get(`/api/v1/projects/${projectId}`)).json()
  expect(drafted.charter.state).toBe('draft')
  expect(drafted.charter.scope).toBe('نطاق أولي')
  await goToStep(page, 'review')
  await page.getByTestId('project-create-submit').click()
  await expect(page.getByText('تم اعتماد الميثاق')).toBeVisible()
  await expect(page).not.toHaveURL(/edit=1/)
  await expect(page.getByTestId('charter-state-badge')).toHaveText('معتمد')
  const finalized = await (await page.request.get(`/api/v1/projects/${projectId}`)).json()
  expect(finalized.charter.state).toBe('final')
})

test('the classification decides which steps the charter walks', async ({ page }) => {
  await login(page)
  const types = await (await page.request.get('/api/v1/project-charter/catalogs/types?active=1')).json()
  const operational = types.items.find((item: { name: string }) => item.name === 'تشغيلي')
  expect(operational.charter_steps).toEqual(['justification', 'scope', 'schedule'])
  await page.goto('/projects/new')
  await page.getByTestId('project-create-name').fill(`E2E charter steps ${Date.now()}`)
  await chooseOption(page, 'charter-field-type', 'غير محدد', 'تشغيلي')
  await expect(page.getByTestId('charter-type-steps')).toContainText('الجدول الزمني')
  await expect(page.getByTestId('charter-type-steps')).not.toContainText('الميزانية')
  await nextStep(page)
  await expect(page).toHaveURL(/step=justification/)
  await nextStep(page)
  await expect(page).toHaveURL(/step=scope/)
  await nextStep(page)
  await expect(page).toHaveURL(/step=schedule/)
  await nextStep(page)
  await expect(page).toHaveURL(/step=review/)
  await expect(page.getByTestId('charter-review-step')).toBeVisible()
})

test('charter tab is readonly until header edit or edit=1', async ({ page }) => {
  await login(page)
  const name = `E2E charter view ${Date.now()}`
  const created = await page.request.post('/api/v1/projects', { data: { name, date_end: '2035-12-31' } })
  expect(created.status()).toBe(201)
  const project = await created.json()
  await page.goto(`/projects/${project.id}/charter`)
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/charter$`))
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByTestId('project-charter-form')).toBeVisible()
  await expect(page.getByTestId('charter-draft-banner')).toBeVisible()
  await expect(page.getByRole('button', { name: 'حفظ' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'العودة إلى المشروع' })).toHaveCount(0)
  await page.getByTestId('project-charter-edit').click()
  await expect(page).toHaveURL(/edit=1/)
  await expect(page.getByTestId('charter-stepper')).toBeVisible()
  await expect(page.getByTestId('charter-save-draft')).toBeVisible()
})

test('charter departure is guarded while preserving the draft', async ({ page }) => {
  await login(page)
  const name = `E2E charter guard ${Date.now()}`
  const created = await page.request.post('/api/v1/projects', { data: { name, date_end: '2035-12-31' } })
  expect(created.status()).toBe(201)
  const project = await created.json()
  await page.goto(`/projects/${project.id}/charter?edit=1&step=justification`)
  const rationale = page.locator('#charter-rationale')
  await rationale.fill('مسودة محلية')
  // Moving between steps rewrites only `step` and is not a departure.
  await page.getByTestId('charter-step-previous').click()
  await expect(page).toHaveURL(/step=basics/)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await nextStep(page)
  await expect(rationale).toHaveValue('مسودة محلية')
  await page.getByTestId('project-charter-form').getByRole('button', { name: 'إلغاء' }).click()

  const dialog = page.getByRole('alertdialog', { name: 'تغييرات غير محفوظة' })
  await expect(dialog).toBeVisible()
  await expect(rationale).toHaveValue('مسودة محلية')
  await dialog.getByRole('button', { name: 'البقاء في الصفحة' }).click()
  await expect(rationale).toHaveValue('مسودة محلية')
  await page.getByTestId('project-charter-form').getByRole('button', { name: 'إلغاء' }).click()
  await dialog.getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/charter$`))
  await expect(page.getByRole('button', { name: 'حفظ' })).toHaveCount(0)
})

test('a 409 keeps the draft until an explicit overwrite after the newer version loads', async ({ page }) => {
  await login(page)
  const name = `E2E charter stale ${Date.now()}`
  const created = await page.request.post('/api/v1/projects', { data: { name, date_end: '2035-12-31' } })
  expect(created.status()).toBe(201)
  const project = await created.json()
  let patchCount = 0
  let sawStalePatch = false
  await page.route(`**/api/v1/projects/${project.id}`, async (route) => {
    const method = route.request().method()
    if (method === 'PATCH') {
      patchCount += 1
      if (patchCount === 1) {
        sawStalePatch = true
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'stale_write', message: 'stale', field: 'expected_updated_at' }),
        })
        return
      }
    }
    if (method === 'GET' && sawStalePatch) {
      const response = await route.fetch()
      const body = await response.json()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...body, updated_at: 'v999' }),
      })
      return
    }
    await route.continue()
  })
  await page.goto(`/projects/${project.id}/charter?edit=1&step=justification`)
  await page.locator('#charter-rationale').fill('kept locally')
  await page.getByTestId('charter-save-draft').click()
  await expect(page.getByTestId('charter-stale-write')).toBeVisible()
  await expect(page.locator('#charter-rationale')).toHaveValue('kept locally')
  await expect(page.getByTestId('charter-overwrite-latest')).toBeEnabled()
  expect(patchCount).toBe(1)
  await page.getByTestId('charter-overwrite-latest').click()
  await expect.poll(() => patchCount).toBe(2)
})

async function pickCalendarDay(page: Page, field: 'date_start' | 'date_end', index: number) {
  const label = field === 'date_start' ? 'تاريخ البدء' : 'تاريخ الانتهاء'
  await page.getByTestId(`charter-field-${field}`).getByRole('button', { name: label, exact: true }).click()
  await page.locator('[data-slot="calendar-cell-trigger"]:not([data-disabled]):not([data-outside-view])').nth(index).click()
}

async function chooseOption(page: Page, fieldTestId: string, current: string, option: string) {
  await page.getByTestId(fieldTestId).getByRole('button', { name: current }).click()
  await page.locator('[data-slot="popover-content"]:visible').last().getByRole('option', { name: option, exact: true }).click()
}

async function choosePerson(page: Page, fieldTestId: string, current: string, person: { id: number; name: string }) {
  await chooseOption(page, fieldTestId, current, person.name)
}

test('charter create/edit round-trip persists every field through the UI and API', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  const name = `E2E charter full ${stamp}`
  const unitName = `E2E owning ${stamp}`
  const unitRes = await page.request.post('/api/v1/project-charter/catalogs/owning-units', {
    data: { name: unitName, sequence: 80 },
  })
  expect(unitRes.status()).toBe(201)
  const unit = await unitRes.json()
  expect(unit.id).toBeGreaterThan(0)

  const types = await (await page.request.get('/api/v1/project-charter/catalogs/types?active=1')).json()
  const technical = types.items.find((item: { name: string }) => item.name === 'تقني')
  expect(technical).toBeTruthy()

  const people = await (await page.request.get('/api/v1/people')).json()
  expect(Array.isArray(people)).toBe(true)
  const nameCount = new Map<string, number>()
  for (const person of people as { id: number; name: string }[]) {
    nameCount.set(person.name, (nameCount.get(person.name) ?? 0) + 1)
  }
  const uniquePeople = (people as { id: number; name: string }[]).filter((person) => nameCount.get(person.name) === 1)
  expect(uniquePeople.length).toBeGreaterThan(0)
  const manager = uniquePeople[0]!
  const sponsor = uniquePeople.find((person) => person.id !== manager.id) ?? manager

  await page.goto('/projects/new')
  await expect(page.getByRole('heading', { name: 'مشروع جديد' })).toBeVisible()
  await expect(page.getByTestId('project-create-name')).toBeEnabled()
  await page.getByTestId('project-create-name').fill(name)
  await page.locator('#charter-description').fill('ملخص البوابة')
  await expect(page.locator('#charter-code')).toBeDisabled()

  await chooseOption(page, 'charter-field-type', 'غير محدد', 'تقني')
  await chooseOption(page, 'charter-field-owning_unit', 'غير محدد', unitName)
  await choosePerson(page, 'charter-field-sponsor', 'غير محدد', sponsor)
  const managerField = page.getByTestId('charter-field-manager')
  const currentManager = (await managerField.getByTestId('project-create-manager').textContent())?.trim() ?? ''
  await choosePerson(page, 'charter-field-manager', currentManager, manager)

  await nextStep(page)
  await expect(page).toHaveURL(/step=justification/)
  await page.locator('#charter-authority').fill('تفويض اللجنة')
  await page.locator('#charter-rationale').fill('انخفاض الرضا')
  await page.getByTestId('charter-objective-0').getByRole('textbox', { name: 'الهدف' }).fill('إطلاق البوابة')
  await page.getByTestId('charter-objective-0').getByRole('textbox', { name: 'المقياس' }).fill('أيام الإنجاز')
  await page.getByRole('button', { name: 'إضافة هدف' }).click()
  await page.getByTestId('charter-objective-1').getByRole('textbox', { name: 'الهدف' }).fill('هدف جزئي')
  await page.getByTestId('charter-deliverable-0').getByRole('textbox', { name: 'اسم المخرج' }).fill('دليل التشغيل')
  await page.getByTestId('charter-deliverable-0').getByRole('textbox', { name: 'معايير القبول' }).fill('توقيع التشغيل')
  await page.getByRole('button', { name: 'إضافة مخرج' }).click()
  await page.getByTestId('charter-deliverable-1').getByRole('textbox', { name: 'اسم المخرج' }).fill('تقرير الإطلاق')
  await page.locator('#charter-benefits').fill('توفير وقت الفريق')
  await nextStep(page)
  await expect(page).toHaveURL(/step=scope/)
  await page.locator('#charter-scope').fill('الويب وواجهة البرمجة')
  await page.locator('#charter-exclusions').fill('تطبيق الجوال')
  await page.locator('#charter-requirements').fill('دخول بالهوية')
  await page.locator('#charter-success').fill('أسبوع بلا انقطاع')
  await nextStep(page)
  await expect(page).toHaveURL(/step=schedule/)
  await pickCalendarDay(page, 'date_start', 4)
  await pickCalendarDay(page, 'date_end', 12)
  await page.getByTestId('charter-field-priority').getByRole('combobox').click()
  await page.getByRole('option', { name: 'عالية' }).click()
  await nextStep(page)
  await expect(page).toHaveURL(/step=budget/)
  await expect(page.locator('#charter-currency')).toBeDisabled()
  await page.getByTestId('charter-field-budget_state').getByRole('combobox').click()
  await page.getByRole('option', { name: 'تقدير' }).click()
  await page.locator('#charter-amount').fill('125.5')
  await nextStep(page)
  await expect(page).toHaveURL(/step=risks/)
  await page.locator('#charter-assumptions').fill('البيانات جاهزة')
  await page.locator('#charter-constraints').fill('بلا توقف نهاراً')
  await page.locator('#charter-closure').fill('تقرير نهائي')
  await nextStep(page)
  await expect(page).toHaveURL(/step=review/)
  await expect(page.getByTestId('charter-review-step')).toContainText('تفويض اللجنة')

  await page.getByTestId('project-create-submit').click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  const createdUrl = new URL(page.url())
  const projectId = Number(createdUrl.pathname.split('/').pop())
  expect(projectId).toBeGreaterThan(0)

  const created = await (await page.request.get(`/api/v1/projects/${projectId}`)).json()
  expect(created.name).toBe(name)
  expect(created.manager.id).toBe(manager.id)
  expect(created.charter.type.id).toBe(technical.id)
  expect(created.charter.owning_unit.id).toBe(unit.id)
  expect(created.charter.sponsor.id).toBe(sponsor.id)
  expect(created.charter.authority).toBe('تفويض اللجنة')
  expect(created.charter.rationale).toBe('انخفاض الرضا')
  expect(created.charter.objectives).toEqual([
    { goal: 'إطلاق البوابة', metric: 'أيام الإنجاز', target: '' },
    { goal: 'هدف جزئي', metric: '', target: '' },
  ])
  expect(created.charter.deliverables[0]).toMatchObject({ name: 'دليل التشغيل', acceptance: 'توقيع التشغيل' })
  expect(created.charter.deliverables[1]).toMatchObject({ name: 'تقرير الإطلاق' })
  expect(created.charter.benefits).toBe('توفير وقت الفريق')
  expect(created.charter.scope).toBe('الويب وواجهة البرمجة')
  expect(created.charter.exclusions).toBe('تطبيق الجوال')
  expect(created.charter.high_level_requirements).toBe('دخول بالهوية')
  expect(created.charter.success).toBe('أسبوع بلا انقطاع')
  expect(created.date_start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(created.date_end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(created.date_start).not.toBe(created.date_end)
  expect(created.charter.budget_state).toBe('estimate')
  expect(created.charter.amount).toBe(125.5)
  expect(created.charter.priority).toBe('high')
  expect(created.charter.code).toMatch(/^PRJ-\d{6}$/)
  expect(created.charter.currency).toBeTruthy()
  expect(created.charter.assumptions).toBe('البيانات جاهزة')
  expect(created.charter.constraints).toBe('بلا توقف نهاراً')
  expect(created.charter.closure).toBe('تقرير نهائي')
  expect(created.charter.state).toBe('final')
  expect(created.charter.type.charter_steps).toEqual(['justification', 'scope', 'schedule', 'budget', 'risks'])

  const inUse = await page.request.delete(`/api/v1/project-charter/catalogs/owning-units/${unit.id}`)
  expect(inUse.status()).toBe(409)

  await page.goto(`/projects/${projectId}/charter`)
  await expect(page.getByTestId('charter-state-badge')).toHaveText('معتمد')
  await expect(page.getByRole('button', { name: 'حفظ' })).toHaveCount(0)
  await page.getByTestId('project-charter-edit').click()
  await expect(page).toHaveURL(/edit=1/)
  await expect(page.locator('#charter-code')).toHaveValue(created.charter.code)
  await expect(page.locator('#charter-code')).toBeDisabled()
  // A final charter keeps a plain save on every step; there is no draft button.
  await expect(page.getByTestId('charter-save-draft')).toHaveCount(0)
  await goToStep(page, 'budget')
  await expect(page.locator('#charter-currency')).toBeDisabled()
  await expect(page.locator('#charter-amount')).toHaveValue('125.5')
  await page.locator('#charter-amount').fill('0')
  await goToStep(page, 'justification')
  await page.locator('#charter-rationale').fill('مبرر محدّث')
  await page.getByTestId('charter-save-final').click()
  await expect(page.getByText('تم حفظ ملف المشروع')).toBeVisible()
  await expect(page).not.toHaveURL(/edit=1/)

  await page.goto(`/projects/${projectId}/charter?edit=1&step=justification`)
  await expect(page.locator('#charter-rationale')).toHaveValue('مبرر محدّث')
  await goToStep(page, 'budget')
  await expect(page.locator('#charter-amount')).toHaveValue('0')
  const patched = await (await page.request.get(`/api/v1/projects/${projectId}`)).json()
  expect(patched.charter.amount).toBe(0)
  expect(patched.charter.budget_state).toBe('estimate')
  expect(patched.charter.rationale).toBe('مبرر محدّث')
  const peopleIds = people.map((person: { id: number }) => person.id)
  expect(peopleIds).toContain(manager.id)
  expect(peopleIds).toContain(sponsor.id)
})
