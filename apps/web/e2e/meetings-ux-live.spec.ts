import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { open } from './support/tasmim6'

const liveEnabled = ['liwan_scratch_meetings_pmo_ux_20261016', 'liwan_scratch_meetings_ux_20261016', 'liwan_scratch_meetings_review_20261016'].includes(process.env.E2E_MEETINGS_LIVE_DB ?? '')
test.skip(!liveEnabled, 'Only the explicitly named isolated meetings acceptance database')
test.beforeAll(async ({ request }) => { expect((await request.get('/login')).status()).toBe(200) })
const fixture = liveEnabled ? JSON.parse(readFileSync(process.env.E2E_MEETINGS_FIXTURE!, 'utf8')) : {}
async function signIn(page: import('@playwright/test').Page, login: string) {
  expect((await page.request.post('/api/auth/login', { data: { login, password: login === 'admin' ? 'admin' : 'meetings_local_test' } })).status()).toBe(200)
}

test('real editor saves minutes, creates a recommendation, returns and persists its topic link', async ({ page }) => {
  await signIn(page, 'meetings_editor')
  await open(page, `/meetings/${fixture.meeting_id}/minutes?tab=minutes&returnTo=/meetings/follow-up?state=active`)
  await page.locator('#minutes-topic-discussion-journey-topic').fill('نقاش محفوظ من الرحلة الحية')
  await page.locator('#meeting-minutes-topic-journey-topic').getByRole('button', { name: 'حفظ وإنشاء توصية', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const title = `توصية قبول حية ${Date.now()}`
  await page.locator('#res-name').fill(title)
  await page.locator('#res-user').click()
  await page.getByRole('option', { name: 'محرر الاجتماعات', exact: true }).click()
  await page.getByRole('listbox').waitFor({ state: 'hidden' })
  await page.locator('#res-period').click()
  await expect(page.locator('#res-period')).toBeFocused()
  await page.locator('#res-period').fill('خلال أسبوع')
  await page.getByRole('button', { name: 'إنشاء توصية', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: title, exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/meetings/${fixture.meeting_id}\\?`))
  const meeting = await (await page.request.get(`/api/v1/meetings/${fixture.meeting_id}`)).json()
  const resolution = meeting.resolutions.find((row: { name: string }) => row.name === title)
  expect(meeting.minutes_form.topics[0].resolution_ids).toContain(resolution.id)
  expect(meeting.minutes_form.topics[0].discussion).toBe('نقاش محفوظ من الرحلة الحية')
})

test('manager completes, reopens and prints the original immutable version', async ({ page }) => {
  await signIn(page, 'admin')
  await open(page, `/meetings/${fixture.meeting_id}`)
  await page.getByRole('button', { name: 'إنهاء', exact: true }).click()
  await page.getByTestId('inline-confirm-action').click()
  await expect(page.getByTestId('meeting-state-badge')).toHaveText('مكتمل')
  await page.getByRole('button', { name: 'إعادة فتح', exact: true }).click()
  await page.getByTestId('inline-confirm-action').click()
  await expect(page.getByTestId('meeting-state-badge')).toHaveText('مسودة')
  await open(page, `/meetings/${fixture.meeting_id}/print?version_id=${fixture.version_id}`)
  await expect(page.getByText('افتتاح النسخة الأولى', { exact: true })).toBeVisible()
  await expect(page.getByText('نقاش محفوظ من الرحلة الحية', { exact: true })).toHaveCount(0)
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByTestId('meeting-print-action')).toBeHidden()
  await expect(page.getByTestId('meeting-print-back')).toBeHidden()
  await page.screenshot({ path: process.env.E2E_MEETINGS_EVIDENCE + '/print-original.png', fullPage: true })
})

test('participant reads without write actions and a user without capability cannot enter meetings', async ({ page }) => {
  await signIn(page, 'meetings_reader')
  await open(page, `/meetings/${fixture.meeting_id}?tab=attachments`)
  await expect(page.getByRole('link', { name: 'تعديل', exact: true })).toHaveCount(0)
  await expect(page.locator('#meeting-attachments input[type=file]')).toHaveCount(0)
  const denied = await page.request.patch(`/api/v1/meetings/${fixture.meeting_id}`, { data: { name: 'Not permitted' } })
  expect(denied.status()).toBe(403)
  await signIn(page, 'meetings_none')
  expect((await page.request.get('/api/v1/meetings/resolutions')).status()).toBe(403)
  await page.goto('/meetings')
  await expect(page.getByRole('heading', { name: 'لا تملك صلاحية فتح هذه الصفحة', level: 1, exact: true })).toBeVisible()
})

test('real attachments validate size and type, upload once and delete with inline confirmation', async ({ page }) => {
  await signIn(page, 'admin')
  await open(page, `/meetings/${fixture.meeting_id}?tab=attachments`)
  const section = page.locator('#meeting-attachments')
  const field = section.locator('input[type=file]')
  let writes = 0
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/attachments')) writes++ })
  await field.setInputFiles({ name: 'oversize.txt', mimeType: 'text/plain', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 'a') })
  await expect(section.getByRole('alert')).toHaveText(/10/)
  expect(writes).toBe(0)
  await field.setInputFiles({ name: 'program.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('test') })
  await expect(section.getByRole('alert')).toContainText('نوع الملف غير مدعوم')
  expect(writes).toBe(0)
  await field.setInputFiles({ name: 'قبول-مرفق.txt', mimeType: 'text/plain', buffer: Buffer.from('ملف تجريبي لقبول الرحلة') })
  await expect(section.getByRole('link', { name: 'قبول-مرفق.txt', exact: true })).toBeVisible()
  expect(writes).toBe(1)
  await section.getByRole('button', { name: 'حذف المرفق', exact: true }).click()
  await section.getByTestId('inline-confirm-action').click()
  await expect(section.getByRole('link', { name: 'قبول-مرفق.txt', exact: true })).toHaveCount(0)
})

test('English dark large-text phone pages retain content without horizontal document overflow', async ({ page, baseURL }) => {
  await signIn(page, 'admin')
  expect((await page.request.patch('/api/v1/me/appearance', { data: { mode: 'dark', font_size: 'large' } })).status()).toBe(200)
  await page.context().addCookies([{ name: 'liwan-locale', value: 'en', url: new URL(baseURL!).origin }])
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/meetings', '/meetings/follow-up?state=all', '/meetings/calendar?year=2026&month=10', `/meetings/${fixture.meeting_id}?tab=minutes`, `/meetings/series/${fixture.series_id}`, '/meetings/series/new']) {
    await open(page, path)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  }
  await open(page, `/meetings/${fixture.meeting_id}?tab=minutes`)
  await page.screenshot({ path: process.env.E2E_MEETINGS_EVIDENCE + '/phone-en-dark-large.png', fullPage: true })
  expect((await page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: 'small' } })).status()).toBe(200)
})

test('a lost-session save keeps the minutes draft and an uncertain recommendation is not retried automatically', async ({ page }) => {
  await signIn(page, 'admin')
  await open(page, `/meetings/${fixture.meeting_id}/minutes?tab=minutes`)
  await page.locator('#minutes-opening').fill('مسودة تبقى عند فقد الجلسة')
  await page.route(`**/api/v1/meetings/${fixture.meeting_id}`, async route => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 403, json: { code: 'forbidden', message: 'Session expired' } })
    else await route.continue()
  })
  await page.locator('#meeting-minutes-topic-journey-topic').getByRole('button', { name: 'حفظ وإنشاء توصية', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('#minutes-opening')).toHaveValue('مسودة تبقى عند فقد الجلسة')
  await page.goto(`/meetings/${fixture.meeting_id}/resolutions/new`)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.locator('#res-name').fill('طلب غير مؤكد')
  await page.locator('#res-user').click()
  await page.getByRole('option', { name: 'محرر الاجتماعات', exact: true }).click()
  await page.getByRole('listbox').waitFor({ state: 'hidden' })
  await page.locator('#res-period').click()
  await expect(page.locator('#res-period')).toBeFocused()
  await page.locator('#res-period').fill('أسبوع')
  let posts = 0
  await page.route(`**/api/v1/meetings/${fixture.meeting_id}/resolutions`, async route => { posts++; await route.abort('failed') })
  await page.getByRole('button', { name: 'إنشاء توصية', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  await expect(page.locator('#res-name')).toHaveValue('طلب غير مؤكد')
  expect(posts).toBe(1)
})

test.describe('responsive meetings pages', () => {
  test.skip(process.env.E2E_MEETINGS_RESPONSIVE !== '1', 'Run the complete responsive matrix only at its acceptance gate')
  for (const width of [390, 768, 1440]) for (const language of ['ar', 'en']) for (const mode of ['light', 'dark']) {
    test(`${width}px ${language} ${mode} large text`, async ({ page, baseURL }) => {
      test.setTimeout(90_000)
      await signIn(page, 'admin')
      await page.request.patch('/api/v1/me/appearance', { data: { mode, font_size: 'large' } })
      await page.context().addCookies([{ name: 'liwan-locale', value: language, url: new URL(baseURL!).origin }])
      await page.setViewportSize({ width, height: 900 })
      const record = await (await page.request.get(`/api/v1/meetings/${fixture.meeting_id}`)).json()
      const paths = ['/meetings', '/meetings/calendar?year=2026&month=10', '/meetings/new', `/meetings/${fixture.meeting_id}`, `/meetings/${fixture.meeting_id}?tab=minutes`, `/meetings/${fixture.meeting_id}/edit`, `/meetings/${fixture.meeting_id}/minutes`, `/meetings/${fixture.meeting_id}/print`, `/meetings/${fixture.meeting_id}/resolutions/new`, `/meetings/${fixture.meeting_id}/resolutions/${record.resolutions[0].id}/edit`, '/meetings/series', '/meetings/series/new', `/meetings/series/${fixture.series_id}`, `/meetings/series/${fixture.series_id}/edit`, '/meetings/follow-up?state=all']
      try {
        for (const path of paths) {
          await open(page, path)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true)
          await expect(page.getByRole('heading', { level: 1 }), path).toHaveCount(1)
          await expect(page.locator('html')).toHaveAttribute('lang', language === 'ar' ? 'ar-SA' : 'en')
          await expect(page.locator('html')).toHaveAttribute('data-font-size', 'large')
        }
      } finally { await page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: 'small' } }) }
    })
  }
})
