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
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

async function openCreate(page: Page) {
  await page.goto('/projects/new')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'مشروع جديد' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'إغلاق' })).toBeVisible()
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

test('create page shows every charter field and allows a name-only save', async ({ page }) => {
  await login(page)
  const before = await (await page.request.get('/api/v1/settings/projects')).json()
  const optional = await page.request.patch('/api/v1/settings/projects', {
    data: { require_manager_on_create: false, require_end_date_on_create: false },
  })
  expect(optional.status()).toBe(200)
  try {
    await page.goto('/projects/new')
    await expect(page.getByRole('dialog')).toBeVisible()
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
    expect(created.charter.state).toBe('approved')
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

