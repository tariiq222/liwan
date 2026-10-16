import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { open } from './support/tasmim6'

const live = process.env.E2E_PHASE_LIVE_DB === 'webvue_scratch_phase_review_20261016'
test.skip(!live, 'Requires the explicitly named disposable phase-review database')
const fixture = live ? JSON.parse(readFileSync(process.env.E2E_PHASE_FIXTURE!, 'utf8')) : {}
async function signIn(page: Page, login: string) {
  expect((await page.request.post('/api/auth/login', { data: { login, password: process.env.E2E_PHASE_PASSWORD } })).status()).toBe(200)
}
async function detail(page: Page, id: number) {
  const response = await page.request.get(`/api/v1/projects/${id}`)
  expect(response.status()).toBe(200)
  return response.json()
}
async function bell(page: Page) {
  const response = await page.request.get('/api/v1/notifications')
  expect(response.status()).toBe(200)
  return (await response.json()).items as Array<{ id: number; kind: string; project_id?: number; is_read: boolean }>
}
async function submit(page: Page) {
  const project = await detail(page, fixture.project_id)
  expect((await page.request.post(`/api/v1/projects/${fixture.project_id}/charter/submit`, { data: { expected_updated_at: project.updated_at } })).status()).toBe(200)
}

test('an upgraded draft stays blocked while its previously approved neighbour retains its phase', async ({ page }) => {
  await signIn(page, 'phase_manager')
  await open(page, `/projects/${fixture.project_id}`)
  await expect(page.getByTestId('project-phase-check-charter_approved')).toHaveAttribute('data-ok', 'false')
  await expect(page.getByTestId('project-phase-move')).toBeDisabled()
  await page.getByTestId('project-phase-fix').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${fixture.project_id}/charter`))
  expect((await detail(page, fixture.approved_project_id)).phase).toBe('planning')
})

test('sponsor return and approval replace bell decisions and unlock the manager phase move', async ({ page }) => {
  test.setTimeout(60_000)
  await signIn(page, 'phase_manager')
  await submit(page)
  await signIn(page, 'phase_sponsor')
  const review = (await bell(page)).find(item => item.kind === 'charter_review' && item.project_id === fixture.project_id)!
  expect(review).toBeTruthy()
  await open(page, '/notifications')
  await page.getByTestId(`notification-${review.id}`).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${fixture.project_id}/charter`))
  await page.getByTestId('charter-return').click()
  await page.getByTestId('charter-return-note').fill('أضف معيار قبول واضحًا قبل اعتماد الميثاق')
  await page.getByTestId('charter-return-confirm').click()
  await expect(page.getByTestId('charter-state-badge')).toHaveText('مسودة')
  expect((await bell(page)).some(item => item.kind === 'charter_review' && item.project_id === fixture.project_id)).toBe(false)
  await signIn(page, 'phase_manager')
  const returned = (await bell(page)).find(item => item.kind === 'charter_returned' && item.project_id === fixture.project_id)!
  expect(returned).toBeTruthy()
  await open(page, '/notifications')
  await expect(page.getByTestId(`notification-${returned.id}`)).toContainText('أُعيد الميثاق للتعديل')
  await submit(page)
  await signIn(page, 'phase_sponsor')
  const pending = (await bell(page)).filter(item => item.kind === 'charter_review' && item.project_id === fixture.project_id)
  expect(pending).toHaveLength(1)
  expect(pending[0]!.is_read).toBe(false)
  await open(page, '/notifications')
  await page.getByTestId(`notification-${pending[0]!.id}`).click()
  await page.getByTestId('charter-approve').click()
  await expect(page.getByTestId('charter-state-badge')).toHaveText('معتمد')
  expect((await bell(page)).some(item => item.kind === 'charter_review' && item.project_id === fixture.project_id)).toBe(false)
  await signIn(page, 'phase_manager')
  const decisions = (await bell(page)).filter(item => item.project_id === fixture.project_id)
  expect(decisions).toHaveLength(1)
  expect(decisions[0]!.kind).toBe('charter_approved')
  await open(page, '/notifications')
  await expect(page.getByTestId(`notification-${decisions[0]!.id}`)).toContainText('اعتُمد الميثاق')
  await page.getByTestId(`notification-${decisions[0]!.id}`).click()
  await open(page, `/projects/${fixture.project_id}`)
  await expect(page.getByTestId('project-phase-move')).toBeEnabled()
  await page.getByTestId('project-phase-move').click()
  await expect(page.getByTestId('project-phase-planning')).toHaveAttribute('data-state', 'current')
  await page.getByTestId('project-phase-back').click()
  await page.getByTestId('inline-confirm-action').click()
  await expect(page.getByTestId('project-phase-initiating')).toHaveAttribute('data-state', 'current')
})

test('a stale manager token and a read-only caller cannot change the current phase', async ({ page }) => {
  await signIn(page, 'phase_manager')
  const initial = await detail(page, fixture.approved_project_id)
  const url = `/api/v1/projects/${fixture.approved_project_id}/phase`
  expect((await page.request.post(url, { data: { phase: 'executing', expected_updated_at: initial.updated_at } })).status()).toBe(200)
  const stale = await page.request.post(url, { data: { phase: 'planning', expected_updated_at: initial.updated_at } })
  expect(stale.status()).toBe(409)
  expect((await stale.json()).code).toBe('stale_write')
  await signIn(page, 'phase_reader')
  const current = await detail(page, fixture.approved_project_id)
  expect((await page.request.post(url, { data: { phase: 'closing', expected_updated_at: current.updated_at } })).status()).toBe(403)
  await open(page, `/projects/${fixture.approved_project_id}`)
  await expect(page.getByTestId('project-phase-executing')).toHaveAttribute('data-state', 'current')
  await expect(page.getByTestId('project-phase-gate')).toHaveCount(0)
  await bell(page)
})

test('phase, charter and bell fit Arabic and English large text in both themes', async ({ page, baseURL }) => {
  test.setTimeout(120_000)
  await signIn(page, 'phase_manager')
  for (const width of [390, 768, 1440]) for (const language of ['ar', 'en']) for (const mode of ['light', 'dark']) {
    expect((await page.request.patch('/api/v1/me/appearance', { data: { mode, font_size: 'large' } })).status()).toBe(200)
    await page.context().addCookies([{ name: 'webvue-locale', value: language, url: new URL(baseURL!).origin }])
    await page.setViewportSize({ width, height: 900 })
    for (const path of [`/projects/${fixture.project_id}`, `/projects/${fixture.project_id}/charter`, '/notifications']) {
      await open(page, path)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width} ${language} ${mode} ${path}`).toBe(true)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    }
  }
  await page.screenshot({ path: process.env.E2E_PHASE_EVIDENCE + '/phase-review.png', fullPage: true })
})
