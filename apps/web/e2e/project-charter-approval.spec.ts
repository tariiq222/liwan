import { expect, test, type Page } from '@playwright/test'
import { login, open } from './support/tasmim6'

// Runs against the isolated mock (e2e/internal-ui-audit-mock.mjs): project 8001 holds a submitted charter the
// signed-in user may review, project 8002 a draft charter that was returned with a note. The mock keeps the
// charter state in memory, so every test starts by restoring the seeds.
const REVIEW_PROJECT = 8001
const RETURNED_PROJECT = 8002

test.beforeEach(async ({ page }) => {
  await login(page)
  const reset = await page.request.post('/api/v1/__mock/reset-charters')
  expect(reset.status()).toBe(200)
})

// The reset also turns the approval policy off, so later specs see the default mock.
test.afterEach(async ({ page }) => {
  await page.request.post('/api/v1/__mock/reset-charters')
})

async function chooseOption(page: Page, fieldTestId: string, current: string, option: string) {
  await page.getByTestId(fieldTestId).getByRole('button', { name: current }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('the sponsor lists the charters waiting for them on the dashboard', async ({ page }) => {
  await open(page, '/projects/dashboard')
  const pending = page.getByTestId('pending-charters')
  await expect(pending).toBeVisible()
  await expect(pending.getByTestId('pending-charter-link')).toHaveCount(1)
  await pending.getByTestId('pending-charter-link').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${REVIEW_PROJECT}/charter`))
})

test('the sponsor returns a submitted charter only with a note', async ({ page }) => {
  await open(page, `/projects/${REVIEW_PROJECT}/charter`)
  await expect(page.getByTestId('charter-state-badge')).toHaveText('بانتظار الاعتماد')
  await page.getByTestId('charter-return').click()
  await expect(page.getByTestId('charter-return-confirm')).toBeDisabled()
  const note = 'أضف مؤشرات قياس واضحة قبل الاعتماد'
  await page.getByTestId('charter-return-note').fill(note)
  await expect(page.getByTestId('charter-return-confirm')).toBeEnabled()
  await page.getByTestId('charter-return-confirm').click()
  await expect(page.getByTestId('charter-state-badge')).toHaveText('مسودة')
  await expect(page.getByText(note)).toBeVisible()
  await expect(page.getByTestId('charter-approve')).toHaveCount(0)
  const detail = await (await page.request.get(`/api/v1/projects/${REVIEW_PROJECT}`)).json()
  expect(detail.charter.state).toBe('draft')
  expect(detail.charter.return_note).toBe(note)
})

test('the sponsor approves a submitted charter and it leaves the waiting list', async ({ page }) => {
  await open(page, `/projects/${REVIEW_PROJECT}/charter`)
  await page.getByTestId('charter-approve').click()
  await expect(page.getByTestId('charter-state-badge')).toHaveText('معتمد')
  const waiting = await (await page.request.get('/api/v1/projects?charter_review=1')).json()
  expect(waiting.items).toHaveLength(0)
})

test('a returned draft shows the sponsor note to the manager', async ({ page }) => {
  await open(page, `/projects/${RETURNED_PROJECT}/charter`)
  await expect(page.getByTestId('charter-state-badge')).toHaveText('مسودة')
  await expect(page.getByText('أضف مؤشرات قياس واضحة للأهداف.')).toBeVisible()
})

test('finishing the wizard sends the charter to the sponsor when approval is required', async ({ page }) => {
  const enable = await page.request.patch('/api/v1/settings/projects', { data: { require_charter_approval: true } })
  expect(enable.status()).toBe(200)
  try {
    await page.goto('/projects/new')
    await expect(page.getByRole('dialog')).toBeVisible()
    const name = `E2E approval ${Date.now()}`
    await page.getByTestId('project-create-name').fill(name)
    // A sponsor other than the signed-in user, so finishing submits instead of self-approving.
    const me = await (await page.request.get('/api/v1/me')).json()
    const people = await (await page.request.get('/api/v1/people')).json() as { id: number; name: string }[]
    const sponsor = people.find(person => person.id !== me.id)
    expect(sponsor).toBeTruthy()
    await chooseOption(page, 'charter-field-sponsor', 'غير محدد', sponsor!.name)
    // Without a classification the wizard walks every step: basics + 5 middle steps, then review.
    for (const step of ['justification', 'scope', 'schedule', 'budget', 'risks']) {
      await page.getByTestId('charter-step-next').click()
      await expect(page).toHaveURL(new RegExp(`step=${step}`))
    }
    await page.getByTestId('charter-step-next').click()
    await expect(page.getByTestId('charter-review-step')).toBeVisible()
    await page.getByTestId('project-create-submit').click()
    await expect(page.getByRole('heading', { name })).toBeVisible()
    const projectId = Number(new URL(page.url()).pathname.split('/')[2])
    await open(page, `/projects/${projectId}/charter`)
    await expect(page.getByTestId('charter-state-badge')).toHaveText('بانتظار الاعتماد')
    const detail = await (await page.request.get(`/api/v1/projects/${projectId}`)).json()
    expect(detail.charter.state).toBe('submitted')
  }
  finally {
    await page.request.patch('/api/v1/settings/projects', { data: { require_charter_approval: false } })
  }
})
