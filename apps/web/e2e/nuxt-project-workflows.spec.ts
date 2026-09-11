import { expect, test, type Locator, type Page } from '@playwright/test'

const ISO_DATE = /^(?!0000)\d{4}-\d{2}-\d{2}$/
const PROJECT_WINDOW = {
  date_start: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
  date_end: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
} as const

test.setTimeout(60_000)

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL?.includes(':3469')) {
    throw new Error('Use E2E_BASE_URL=http://127.0.0.1:3469 and the isolated migration database')
  }
  const login = await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
  expect(login.status()).toBe(200)
})

async function json(page: Page, method: 'get' | 'post' | 'patch', url: string, data?: unknown, status = 200) {
  const response = await page.request[method](url, data === undefined ? {} : { data })
  expect(response.status(), `${method} ${url}: ${response.status()} ${await response.text()}`).toBe(status)
  return response.json()
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE.test(value)
}

async function assertWorkflowChrome(page: Page) {
  const sheet = page.locator('.nasq-ui-route-sheet')
  if (new URL(page.url()).searchParams.get('fullPage') === '1') {
    await expect(sheet).toHaveCount(0)
    return
  }
  await expect(sheet).toHaveCount(1)
  await expect(sheet).toBeVisible()
}

async function pickEnabledCalendarDay(page: Page, trigger: Locator, position: 'first' | 'last', maxEnabled?: number) {
  await trigger.click()
  const grid = page.locator('[data-slot="grid"]')
  await expect(grid).toBeVisible()
  const days = grid.locator('[role="button"]:not([data-disabled]):not([data-outside-view])')
  await expect(days.first()).toBeVisible()
  if (maxEnabled) {
    expect(await days.count()).toBeLessThanOrEqual(maxEnabled)
    expect(await grid.getByRole('button', { disabled: true }).count()).toBeGreaterThan(0)
  }
  await (position === 'last' ? days.last() : days.first()).click()
  await expect(grid).toHaveCount(0)
}

function menuTrigger(root: Locator, accessibleName?: string) {
  const named = accessibleName
    ? root.getByRole('combobox', { name: accessibleName, exact: true }).or(root.getByRole('button', { name: accessibleName, exact: true }))
    : root.getByRole('combobox').or(root.getByRole('button'))
  return named.first()
}

async function chooseMenuOption(page: Page, trigger: Locator, optionName: string) {
  await trigger.click()
  const option = page.getByRole('option', { name: optionName, exact: true })
  await expect(option).toBeVisible()
  await option.click()
}

async function uniquePeople(page: Page) {
  const people = await json(page, 'get', '/api/v1/people')
  expect(Array.isArray(people)).toBe(true)
  const counts = new Map<string, number>()
  for (const person of people as { id: number; name: string }[]) {
    counts.set(person.name, (counts.get(person.name) ?? 0) + 1)
  }
  return (people as { id: number; name: string }[]).filter(person => counts.get(person.name) === 1)
}

async function duplicateIds(page: Page) {
  return page.locator('form').evaluate(form => {
    const counts = new Map<string, number>()
    for (const element of form.querySelectorAll('[id]')) {
      if (!element.id) continue
      counts.set(element.id, (counts.get(element.id) ?? 0) + 1)
    }
    return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id)
  })
}

async function seedProject(page: Page, name: string, extra: Record<string, unknown> = {}) {
  return json(page, 'post', '/api/v1/projects', {
    name,
    date_start: PROJECT_WINDOW.date_start,
    date: PROJECT_WINDOW.date_end,
    ...extra,
  }, 201)
}

test('create project via the form persists a chosen manager and end date', async ({ page }) => {
  const stamp = Date.now()
  const name = `Nuxt create ${stamp}`
  const people = await uniquePeople(page)
  expect(people.length).toBeGreaterThan(0)
  const manager = people[0]!

  await page.goto('/projects/new?fullPage=1')
  await assertWorkflowChrome(page)
  const form = page.getByTestId('project-create-form')
  await expect(form).toBeVisible()
  await expect(page.getByTestId('project-create-defaults-error')).toHaveCount(0)
  const nameField = form.getByTestId('project-create-name')
  await expect(nameField).toBeEnabled()
  await nameField.fill(name)

  const managerTrigger = form.getByTestId('project-create-manager')
  await expect(managerTrigger).toBeEnabled()
  await managerTrigger.click()
  const search = page.getByRole('combobox').last()
  await expect(search).toBeVisible()
  await search.fill(manager.name)
  await page.getByRole('option', { name: manager.name, exact: true }).click()
  await expect(form.getByTestId('project-create-manager')).toContainText(manager.name)
  await expect(managerTrigger).toBeFocused()

  await pickEnabledCalendarDay(page, form.getByTestId('project-create-end-date'), 'last')
  await form.getByTestId('project-create-submit').click()
  await expect(page).toHaveURL(/\/projects\/\d+/)
  const id = Number(page.url().match(/\/projects\/(\d+)/)?.[1])
  expect(id).toBeGreaterThan(0)

  const detail = await json(page, 'get', `/api/v1/projects/${id}`)
  expect(detail.name).toBe(name)
  expect(detail.manager?.id).toBe(manager.id)
  expect(isIsoDate(detail.date_end)).toBe(true)
})

test('milestone create and edit keep dates inside the project and persist outputs', async ({ page }) => {
  const stamp = Date.now()
  const project = await seedProject(page, `Nuxt milestone ${stamp}`)
  const createdName = `معلم إنشاء ${stamp}`
  const editedName = `معلم تعديل ${stamp}`
  const outputName = `مخرج ${stamp}`
  const renamedOutput = `مخرج محدث ${stamp}`

  await page.goto(`/projects/${project.id}/milestones/new?fullPage=1`)
  await assertWorkflowChrome(page)
  const form = page.getByTestId('milestone-form')
  await expect(form.locator('#milestone-name')).toBeEnabled()
  await form.locator('#milestone-name').fill(createdName)
  await pickEnabledCalendarDay(page, form.getByRole('button', { name: /تاريخ البداية/ }), 'first', 5)
  await pickEnabledCalendarDay(page, form.getByRole('button', { name: /الموعد/ }), 'last', 5)
  await form.getByRole('button', { name: 'إضافة مخرج', exact: true }).click()
  await form.getByRole('textbox', { name: 'اسم المخرج', exact: true }).fill(outputName)
  await form.getByRole('button', { name: 'إنشاء', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}\\?tab=milestones$`))

  const createdList = await json(page, 'get', `/api/v1/projects/${project.id}/milestones`) as Array<{
    id: number
    name: string
    start_date: string | null
    deadline: string | null
    deliverables: Array<{ name: string; done: boolean }>
  }>
  const created = createdList.find(item => item.name === createdName)
  expect(created).toBeTruthy()
  expect(isIsoDate(created!.start_date)).toBe(true)
  expect(isIsoDate(created!.deadline)).toBe(true)
  expect(created!.start_date! <= created!.deadline!).toBe(true)
  expect(created!.start_date! >= PROJECT_WINDOW.date_start).toBe(true)
  expect(created!.deadline! <= PROJECT_WINDOW.date_end).toBe(true)
  expect(created!.deliverables).toEqual([{ name: outputName, done: false }])

  await page.goto(`/projects/${project.id}/milestones/${created!.id}/edit?fullPage=1`)
  await assertWorkflowChrome(page)
  const editForm = page.getByTestId('milestone-form')
  await expect(editForm.locator('#milestone-name')).toHaveValue(createdName)
  await editForm.locator('#milestone-name').fill(editedName)
  await editForm.getByRole('textbox', { name: 'اسم المخرج', exact: true }).fill(renamedOutput)
  await editForm.getByRole('switch', { name: 'تم تسليم المخرج', exact: true }).click()
  await editForm.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}\\?tab=milestones$`))

  const updated = await json(page, 'get', `/api/v1/projects/${project.id}/milestones`) as typeof createdList
  expect(updated.find(item => item.id === created!.id)).toMatchObject({
    name: editedName,
    start_date: created!.start_date,
    deadline: created!.deadline,
    deliverables: [{ name: renamedOutput, done: true }],
  })
})

test('finance budget and expense save through the form and reread as actual ledger amounts', async ({ page }) => {
  const stamp = Date.now()
  const project = await seedProject(page, `Nuxt finance ${stamp}`)
  const budgetTitle = `ميزانية UI ${stamp}`
  const expenseTitle = `مصروف UI ${stamp}`

  await page.goto(`/projects/${project.id}/finance/new?kind=budget&fullPage=1`)
  await assertWorkflowChrome(page)
  const budgetForm = page.getByTestId('finance-form')
  await expect(budgetForm.locator('#finance-title')).toBeEnabled()
  await budgetForm.locator('#finance-title').fill(budgetTitle)
  await budgetForm.getByTestId('finance-amount').fill('1000')
  await budgetForm.locator('button[type="submit"]').click()
  await expect(page.getByTestId('project-finance-page')).toBeVisible()

  await expect.poll(async () => {
    const list = await json(page, 'get', `/api/v1/projects/${project.id}/finance?kind=budget`)
    return list.items.find((item: { title: string }) => item.title === budgetTitle)?.amount ?? null
  }).toBe(1000)

  await page.goto(`/projects/${project.id}/finance/new?kind=expense&fullPage=1`)
  await assertWorkflowChrome(page)
  const expenseForm = page.getByTestId('finance-form')
  await expect(expenseForm.locator('#finance-title')).toBeEnabled()
  await expenseForm.locator('#finance-title').fill(expenseTitle)
  await expenseForm.getByTestId('finance-amount').fill('250.5')
  await pickEnabledCalendarDay(page, expenseForm.getByRole('button', { name: /تاريخ المصروف/ }), 'first')
  const picker = expenseForm.getByTestId('finance-budget-picker')
  await picker.getByRole('textbox', { name: 'ابحث في عناوين الميزانية…', exact: true }).fill(budgetTitle)
  await chooseMenuOption(page, menuTrigger(picker), budgetTitle)
  await expenseForm.locator('button[type="submit"]').click()
  await expect(page.getByTestId('project-finance-page')).toBeVisible()

  await expect.poll(async () => {
    const list = await json(page, 'get', `/api/v1/projects/${project.id}/finance?kind=expense`)
    return list.items.find((item: { title: string }) => item.title === expenseTitle)?.amount ?? null
  }).toBe(250.5)
  const ledgers = await json(page, 'get', `/api/v1/projects/${project.id}/finance`)
  const budget = ledgers.items.find((item: { title: string }) => item.title === budgetTitle)
  const expense = ledgers.items.find((item: { title: string }) => item.title === expenseTitle)
  expect(budget).toMatchObject({ kind: 'budget', amount: 1000 })
  expect(expense).toMatchObject({ kind: 'expense', amount: 250.5, budget_entry_id: budget.id })
  expect(isIsoDate(expense.expense_date)).toBe(true)
  const summary = await json(page, 'get', `/api/v1/projects/${project.id}/finance/summary`)
  expect(summary).toMatchObject({ planned: 1000, actual: 250.5, remaining: 749.5, budget_count: 1, expense_count: 1 })
})

test('template editor keeps a milestone key named none distinct from the empty sentinel and apply persists it', async ({ page }) => {
  const stamp = Date.now()
  const milestoneName = `معلم none ${stamp}`
  const taskName = `مهمة مرتبطة none ${stamp}`
  const template = await json(page, 'post', '/api/v1/project-templates', {
    name: `قالب none ${stamp}`,
    description: 'milestone key none must not collide with the empty sentinel',
    definition: {
      stages: [{ key: 'stage-1', name: 'التخطيط', fold: false }],
      milestones: [{ key: 'none', name: milestoneName, offset_days: 4 }],
      tasks: [{
        key: 'task-1',
        name: taskName,
        stage_key: 'stage-1',
        start_offset: 0,
        duration_days: 2,
        milestone_key: null,
        dependency_keys: [],
      }],
    },
  }, 201)

  await page.goto(`/project-templates/${template.id}/edit?fullPage=1`)
  await assertWorkflowChrome(page)
  const taskNameField = page.locator('[name="task-name-0"]')
  await expect(taskNameField).toBeEnabled()
  await expect(taskNameField).toHaveValue(taskName)
  await menuTrigger(page.locator('form'), 'المعلم').click()
  await expect(page.getByRole('option', { name: 'بدون معلم', exact: true })).toBeVisible()
  await page.getByRole('option', { name: milestoneName, exact: true }).click()
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/project-templates/${template.id}(?:\\?.*)?$`))

  const saved = await json(page, 'get', `/api/v1/project-templates/${template.id}`)
  expect(saved.definition.milestones).toEqual([
    expect.objectContaining({ key: 'none', name: milestoneName }),
  ])
  expect(saved.definition.tasks[0]).toMatchObject({ name: taskName, milestone_key: 'none' })

  const appliedName = `مشروع من قالب none ${stamp}`
  await page.goto(`/project-templates/${template.id}/apply?fullPage=1`)
  await assertWorkflowChrome(page)
  const projectName = page.locator('[name="project-name"]')
  await expect(projectName).toBeEnabled()
  await projectName.fill(appliedName)
  await pickEnabledCalendarDay(page, page.locator('[name="project-start-date"]'), 'first')
  await page.getByRole('button', { name: 'استخدام القالب', exact: true }).click()
  await expect(page).toHaveURL(/\/projects\/\d+$/)
  const projectId = Number(new URL(page.url()).pathname.split('/').at(-1))

  const schedule = await json(page, 'get', `/api/v1/projects/${projectId}/schedule`)
  const appliedMilestone = schedule.milestones.find((item: { name: string }) => item.name === milestoneName)
  const appliedTask = schedule.tasks.find((item: { name: string }) => item.name === taskName)
  const projectDetail = await json(page, 'get', `/api/v1/projects/${projectId}`)
  const expectedDeadline = new Date(`${projectDetail.date_start}T12:00:00Z`)
  expectedDeadline.setUTCDate(expectedDeadline.getUTCDate() + 4)
  expect(appliedMilestone).toMatchObject({ name: milestoneName, deadline: expectedDeadline.toISOString().slice(0, 10) })
  expect(appliedTask).toMatchObject({ name: taskName, milestone_id: appliedMilestone.id })
})

test('governance closed-task checkbox toggles the linked-task list without duplicate ids', async ({ page }) => {
  const stamp = Date.now()
  const project = await seedProject(page, `Nuxt register ${stamp}`)
  await json(page, 'patch', `/api/v1/projects/${project.id}`, { nasq_completion_approval: 'none' })
  const openTask = await json(page, 'post', '/api/v1/tasks', { name: `مهمة مفتوحة ${stamp}`, project_id: project.id }, 201)
  const closedTask = await json(page, 'post', '/api/v1/tasks', { name: `مهمة مغلقة ${stamp}`, project_id: project.id }, 201)
  expect((await page.request.post(`/api/v1/tasks/${closedTask.id}/transition`, { data: { state: 'done' } })).ok()).toBeTruthy()

  await page.goto(`/projects/${project.id}/register/new?fullPage=1`)
  await assertWorkflowChrome(page)
  const title = page.locator('#register-title')
  await expect(title).toBeEnabled()
  await title.fill(`خطر مرتبط بمهمة مغلقة ${stamp}`)

  const closed = page.getByRole('checkbox', { name: 'المهام المنتهية والملغاة', exact: true })
  await expect(closed).toHaveCount(1)
  await expect(closed).not.toBeChecked()
  expect(await duplicateIds(page)).toEqual([])
  expect(await page.locator('#register-task-closed').count()).toBe(1)

  const taskTrigger = page.locator('#register-task')
  await expect(taskTrigger).toBeEnabled()
  await taskTrigger.click()
  await expect(page.getByRole('option', { name: openTask.name, exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: closedTask.name, exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await closed.check()
  await expect(closed).toBeChecked()
  expect(await page.locator('#register-task-closed').count()).toBe(1)
  expect(await duplicateIds(page)).toEqual([])
  await expect(taskTrigger).toBeEnabled()
  await taskTrigger.click()
  await expect(page.getByRole('option', { name: closedTask.name, exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: openTask.name, exact: true })).toHaveCount(0)
  await page.getByRole('option', { name: closedTask.name, exact: true }).click()

  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/register(?:\\?.*)?$`))

  await expect.poll(async () => {
    const list = await json(page, 'get', `/api/v1/projects/${project.id}/register`)
    return list.items.find((item: { title: string }) => item.title === `خطر مرتبط بمهمة مغلقة ${stamp}`) ?? null
  }).toMatchObject({ task: { id: closedTask.id, name: closedTask.name } })
})
