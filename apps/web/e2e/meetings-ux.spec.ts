import { expect, test } from '@playwright/test'
import { login, open } from './support/tasmim6'

test.skip(process.env.E2E_MEETINGS_UX !== '1', 'Requires the isolated synthetic meetings fixture, never a customer database')
test.use({ viewport: { width: 1440, height: 900 } })
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/v1/meetings-test/reset')).status()).toBe(200)
  await login(page)

})

test('only the selected meeting section is visible and recommendation search survives tab changes', async ({ page }) => {
  await open(page, '/meetings/1?tab=summary')
  for (const tab of ['summary', 'agenda', 'minutes', 'attachments', 'history', 'versions']) {
    await page.goto(`/meetings/1?tab=${tab}`)
    await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
    await expect(page.locator('#meeting-resolutions')).toBeHidden()
    await expect(page.locator('#meeting-follow-up')).toBeHidden()
  }
  await page.getByTestId('meeting-tab-resolutions').click()
  await expect(page.locator('#meeting-resolutions')).toBeVisible()
  await page.getByPlaceholder('ابحث في التوصيات', { exact: true }).fill('اعتماد')
  await page.getByTestId('meeting-tab-summary').click()
  await expect(page.locator('#meeting-resolutions')).toBeHidden()
  await page.getByTestId('meeting-tab-resolutions').click()
  await expect(page.getByPlaceholder('ابحث في التوصيات', { exact: true })).toHaveValue('اعتماد')
})

test('series occurrence and its editors retain the filtered series origin', async ({ page }) => {
  const origin = '/meetings/series/1?tab=sessions&session_view=table&session_state=confirmed'
  await open(page, origin)
  await page.getByRole('link', { name: 'اجتماع متابعة التحول الرقمي', exact: true }).click()
  const back = page.getByRole('link', { name: 'رجوع', exact: true })
  await expect(back).toHaveAttribute('href', origin)
  await page.getByRole('link', { name: 'تعديل', exact: true }).click()
  await back.click()
  await expect(back).toHaveAttribute('href', origin)
  await back.click()
  await expect(page).toHaveURL(origin)
  await page.getByRole('link', { name: 'إضافة لقاء', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click()
  await expect(page).toHaveURL(origin)
})

test('the meeting has five sections and existing agenda and version links still open their content', async ({ page }) => {
  await open(page, '/meetings/1?tab=agenda')
  await expect(page.getByTestId('meeting-tabs').getByRole('link')).toHaveCount(5)
  await expect(page.locator('#meeting-agenda')).toBeVisible()
  await expect(page.getByTestId('meeting-tab-summary')).toHaveAttribute('aria-current', 'page')
  await open(page, '/meetings/1?tab=versions')
  await expect(page.getByTestId('meeting-tab-history')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('meeting-minutes-document')).toBeVisible()
})

test('list and calendar preserve filters and a chosen day seeds creation', async ({ page }) => {
  await open(page, '/meetings?q=متابعة&mine=1&state=confirmed&date_from=2026-09-01')
  await page.getByTestId('meeting-view-calendar').click()
  await expect(page).toHaveURL(/\/meetings\/calendar\?/)
  const calendar = new URL(page.url())
  expect(calendar.searchParams.get('q')).toBe('متابعة')
  expect(calendar.searchParams.get('mine')).toBe('1')
  expect(calendar.searchParams.get('month')).toBe('9')
  await open(page, '/meetings/calendar?year=2026&month=9&day=2026-09-15')
  await page.getByTestId('meeting-calendar-new').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('#meeting-date')).toContainText('15')
})

test('recommendation validation starts on submit and focuses the missing title', async ({ page }) => {
  await open(page, '/meetings/1/resolutions/new?tab=resolutions')
  const create = page.getByRole('button', { name: /إنشاء/, exact: false })
  await expect(create).toBeEnabled()
  await create.click()
  await expect(page.locator('#res-name')).toBeFocused()
  await expect(page.locator('#res-name')).toHaveAttribute('aria-invalid', 'true')
})

test('minutes save before recommendation creation and return to the topic without duplicate POST on refresh', async ({ page }) => {
  await open(page, '/meetings/1/minutes?tab=minutes&listOrigin=%2Fmeetings%2Fseries%2F1%3Ftab%3Dsessions')
  await page.locator('#minutes-topic-discussion-digital-transformation').fill('نقاش محفوظ قبل إضافة التوصية')
  await page.locator('#meeting-minutes-topic-digital-transformation').getByRole('button', { name: 'حفظ وإنشاء توصية', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.locator('#res-name').fill('توصية رحلة المحضر')
  await page.locator('#res-user').click()
  await page.getByRole('option', { name: 'أحمد العتيبي', exact: true }).click()
  await page.getByRole('listbox').waitFor({ state: 'hidden' })
  await page.locator('#res-period').click()
  await expect(page.locator('#res-period')).toBeFocused()
  await page.locator('#res-period').fill('خلال أسبوع')

  await expect(page.locator('#res-period')).toHaveValue('خلال أسبوع')
  await page.getByRole('button', { name: 'إنشاء توصية', exact: true }).click()
  await expect(page).toHaveURL(/\/meetings\/1\/minutes\?/)
  await expect(page.getByText('أُنشئت التوصية؛ احفظ المحضر لتثبيت ربطها بالموضوع.', { exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'توصية رحلة المحضر', exact: true })).toBeChecked()
  await page.reload()
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  await expect(page.getByRole('checkbox', { name: 'توصية رحلة المحضر', exact: true })).toBeChecked()
  expect((await (await page.request.get('/api/v1/meetings-test/state')).json()).created).toBe(1)
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click()
  await expect(page).toHaveURL(/\/meetings\/1\?/)
  const state = await (await page.request.get('/api/v1/meetings-test/state')).json()
  expect(state.meeting.minutes_form.topics[0].resolution_ids).toContain(21)
  expect(state.meeting.minutes_form.topics[0].discussion).toBe('نقاش محفوظ قبل إضافة التوصية')
  await page.getByRole('link', { name: 'رجوع', exact: true }).click()
  await expect(page).toHaveURL('/meetings/series/1?tab=sessions')
})

test('a rejected minutes save retains the draft and never opens recommendation creation', async ({ page }) => {
  await open(page, '/meetings/1/minutes?tab=minutes')
  await page.locator('#minutes-opening').fill('مسودة تبقى عند التعارض')
  await page.route('**/api/v1/meetings/1', async route => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 409, json: { code: 'conflict', message: 'تم تحديث الاجتماع.' } })
    else await route.continue()
  })
  await page.locator('#meeting-minutes-topic-digital-transformation').getByRole('button', { name: 'حفظ وإنشاء توصية', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('#minutes-opening')).toHaveValue('مسودة تبقى عند التعارض')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await (await page.request.get('/api/v1/meetings-test/state')).json()).created).toBe(0)
})

test('minutes topics read as cards on a phone while printing keeps a table', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page, '/meetings/1?tab=minutes')
  const document = page.getByTestId('meeting-minutes-document')
  await expect(document.locator('table:visible')).toHaveCount(0)
  await expect(document.getByRole('heading', { name: 'خطة التنفيذ', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await open(page, '/meetings/1/print')
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByTestId('meeting-minutes-document').locator('table:visible')).toHaveCount(1)
})

test('followup retains its search and state after opening a meeting and returning', async ({ page }) => {
  await open(page, '/meetings/follow-up?state=active&q=اعتماد&mine=1')
  const result = page.locator('tbody').getByRole('link', { name: 'اعتماد خطة التنفيذ', exact: true })
  await result.click()
  await expect(page).toHaveURL(/\/meetings\/1\?/)
  await page.getByRole('link', { name: 'رجوع', exact: true }).click()
  await expect(page).toHaveURL('/meetings/follow-up?state=active&q=اعتماد&mine=1')
})

test('attachment errors stay beside the files and a failed delete retains its row and confirmation', async ({ page }) => {
  await open(page, '/meetings/1?tab=attachments')
  const section = page.locator('#meeting-attachments')
  await page.route('**/api/v1/meetings/1/attachments**', async route => {
    if (route.request().method() !== 'GET') await route.fulfill({ status: 500, json: { code: 'unavailable', message: 'تعذر حفظ الملف التجريبي.' } })
    else await route.continue()
  })
  await section.locator('input[type=file]').setInputFiles({ name: 'review.txt', mimeType: 'text/plain', buffer: Buffer.from('Review') })
  await expect(section.getByRole('alert')).toBeVisible()
  const file = section.getByRole('link').first()
  const name = await file.innerText()
  await section.getByRole('button', { name: 'حذف المرفق', exact: true }).first().click()
  await section.getByRole('button', { name: 'تأكيد الحذف', exact: true }).click()
  await expect(section.getByRole('link', { name, exact: true })).toBeVisible()
  await expect(section.getByRole('button', { name: 'تأكيد الحذف', exact: true })).toBeVisible()
})

test('a multi-day meeting summary keeps its end date visible', async ({ page }) => {
  expect((await page.request.patch('/api/v1/meetings/1', { data: {
    meeting_date: '2026-10-16', start_datetime: '2026-10-16T10:00:00Z', end_datetime: '2026-10-18T10:00:00Z',
  } })).status()).toBe(200)
  await open(page, '/meetings/1')
  await expect(page.locator('[data-slot="record-summary"]')).toContainText('18/10/2026')
})

test('a converted task link follows the next server visibility projection', async ({ page }) => {
  await page.clock.install()
  expect((await page.request.post('/api/v1/meetings/1/resolutions', { data: { name: 'توصية تحويل للتحقق', responsible_id: 1, execution_period: 'خلال أسبوع' } })).status()).toBe(201)
  const meeting = await (await page.request.get('/api/v1/meetings/1')).json()
  const recommendation = meeting.resolutions.find((item: { task_linked: boolean; can_edit_decision: boolean }) => !item.task_linked && item.can_edit_decision)
  expect(recommendation).toBeTruthy()
  const projects = await (await page.request.get('/api/v1/projects')).json()
  const project = projects.items[0]
  let converted = false
  let visible = true
  await page.route('**/api/v1/meetings/1', async route => {
    const updated = structuredClone(meeting)
    if (converted) Object.assign(updated.resolutions.find((item: { id: number }) => item.id === recommendation.id), {
      task_id: visible ? 42 : null, task_linked: true, allowed_actions: [], can_edit_decision: false, can_update_execution: false,
    })
    await route.fulfill({ status: 200, json: updated })
  })
  await page.route(`**/api/v1/meetings/1/resolutions/${recommendation.id}/convert`, async route => {
    converted = true
    await route.fulfill({ status: 200, json: { id: 42, name: recommendation.name } })
  })
  await open(page, '/meetings/1?tab=resolutions')
  const row = page.locator('#meeting-resolutions li').filter({ has: page.getByRole('heading', { name: recommendation.name, exact: true }) })
  await row.locator('summary').click()
  await page.locator(`#meeting-project-${recommendation.id}`).click()
  await page.getByRole('option', { name: project.name, exact: true }).click()
  await row.getByRole('button', { name: 'تحويل لمهمة', exact: true }).click()
  const taskLink = row.locator('a[href="/tasks/42"]')
  await expect(taskLink).toBeVisible()
  await expect(page).toHaveURL(/\/meetings\/1\?tab=resolutions/)
  visible = false
  // The application cache considers a projection fresh for five seconds.
  await page.clock.fastForward(5_001)
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/meetings/1')
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await refreshed
  await expect(taskLink).toHaveCount(0)
  await expect(row).toContainText('هذه التوصية مرتبطة بمهمة لا يمكنك فتحها.')
})
