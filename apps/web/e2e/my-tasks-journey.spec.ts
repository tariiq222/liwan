import { expect, test } from '@playwright/test'
import { enterFoundation } from './support/uxFoundations'
import { fakeApi } from './support/myTaskApi'

test.describe.configure({ timeout: 40_000 })

test('edit is a direct page and cancel protects its changed title and source', async ({ page }) => {
  await fakeApi(page)
  await enterFoundation(page, '/my-tasks/7/edit?listOrigin=%2Fmy-tasks%3Fscope%3Dcreated%23rows')
  await expect(page.getByRole('heading', { name: 'تعديل المهمة', level: 1 })).toBeVisible({ timeout: 5000 })
  await page.getByLabel('عنوان المهمة', { exact: true }).fill('مسودة باقية')
  await page.getByRole('button', { name: 'إلغاء', exact: true }).click()
  const guard = page.getByTestId('unsaved-changes-dialog')
  await expect(guard).toBeVisible()
  await guard.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
  await expect(page.getByLabel('عنوان المهمة', { exact: true })).toHaveValue('مسودة باقية')
})

test('creation focuses the required name after a failed attempt from another field', async ({ page }) => {
  await enterFoundation(page, '/my-tasks/new')
  await page.getByLabel('الوصف', { exact: true }).click()
  await page.getByTestId('my-task-form-submit').click()
  await expect(page.getByText('عنوان المهمة مطلوب', { exact: true })).toBeVisible()
  await expect(page.locator('#my-task-name')).toBeFocused()
})


test('edit saves only the changed fields and preserves the exact list source through refresh', async ({ page }) => {
  const api = await fakeApi(page)
  await enterFoundation(page, '/my-tasks/7?returnTo=%2Fmy-tasks%3Fscope%3Dcreated%26q%3Da%2526b%23rows')
  await page.getByRole('link', { name: 'تعديل', exact: true }).click()
  await expect(page).toHaveURL(/\/my-tasks\/7\/edit\?listOrigin=/)
  await page.reload()
  await page.getByLabel('عنوان المهمة', { exact: true }).fill('عنوان محفوظ')
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('عنوان محفوظ')
  expect(api.writes().map(write => write.body)).toEqual([{ name: 'عنوان محفوظ' }])
  await page.getByRole('link', { name: 'العودة إلى مهامي', exact: true }).click()
  await expect(page).toHaveURL(/\/my-tasks\?scope=created&q=a%26b#rows$/)
})

for (const status of [403, 409, 500]) {
  test(`a ${status} edit error retains the draft on the edit page`, async ({ page }) => {
    await fakeApi(page)
    await page.route('**/api/v1/my-tasks/7', route => route.request().method() === 'PATCH'
      ? route.fulfill({ status, json: { code: status === 409 ? 'conflict' : 'invalid', message: 'لم تحفظ التغييرات' } }) : route.fallback())
    await enterFoundation(page, '/my-tasks/7/edit')
    await page.getByLabel('عنوان المهمة', { exact: true }).fill('مسودة لا تضيع')
    await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click()
    await expect(page.getByRole('alert').first()).toContainText('لم تحفظ التغييرات')
    await expect(page.getByLabel('عنوان المهمة', { exact: true })).toHaveValue('مسودة لا تضيع')
    await expect(page).toHaveURL(/\/my-tasks\/7\/edit$/)
  })
}

for (const status of [500, 403, 404]) {
  test(`a ${status} background record failure uses the correct state without silent stale actions`, async ({ page }) => {
    await fakeApi(page)
    await enterFoundation(page, '/my-tasks/7')
    await expect(page.locator('[data-slot="record-summary"]')).toBeVisible()
    let failed = 0
    await page.route('**/api/v1/my-tasks/7', route => {
      failed++
      return route.fulfill({ status, json: { code: status === 403 ? 'forbidden' : status === 404 ? 'not_found' : 'internal', message: 'تعذر تحديث المهمة' } })
    })
    await page.clock.install()
    await page.clock.fastForward(6000)
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
    await expect.poll(() => failed).toBeGreaterThan(0)
    const slot = status === 500 ? 'error-state' : status === 403 ? 'forbidden-state' : 'not-found-state'
    await expect(page.locator(`[data-slot="${slot}"]`)).toBeVisible({ timeout: 7000 })
    if (status === 500) await expect(page.locator('[data-slot="record-main"]')).toBeVisible()
    else {
      await expect(page.locator('[data-slot="record-body"]')).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'تعديل', exact: true })).toHaveCount(0)
    }
  })
}

test('a child edit keeps its parent and the parent keeps the filtered list', async ({ page }) => {
  await fakeApi(page)
  const parent = '/my-tasks/7?returnTo=%2Fmy-tasks%3Fscope%3Dcreated%23rows'
  await enterFoundation(page, `/my-tasks/11?returnTo=${encodeURIComponent(parent)}`)
  await expect(page.getByRole('link', { name: 'العودة إلى اشترِ الورق', exact: true })).toBeVisible({ timeout: 5000 })
  await page.getByRole('link', { name: 'تعديل', exact: true }).click()
  await expect(page).toHaveURL(/\/my-tasks\/11\/edit\?listOrigin=/)
  await page.reload()
  await page.getByRole('button', { name: 'إلغاء', exact: true }).click()
  await page.getByRole('link', { name: 'العودة إلى اشترِ الورق', exact: true }).click()
  await expect(page).toHaveURL(/\/my-tasks\/7\?returnTo=/)
  await page.getByRole('link', { name: 'العودة إلى مهامي', exact: true }).click()
  await expect(page).toHaveURL(/\/my-tasks\?scope=created#rows$/)
})

for (const field of ['comment', 'subtask'] as const) {
  test(`leaving with an unsent ${field} offers one guard and preserves text and focus`, async ({ page }) => {
    await fakeApi(page)
    await enterFoundation(page, '/my-tasks/7')
    const input = field === 'comment' ? page.getByPlaceholder('اكتب تعليقًا') : page.getByPlaceholder('عنوان المهمة الفرعية')
    await input.fill('مسودة قسم باقية')
    await page.getByRole('link', { name: 'العودة إلى مهامي', exact: true }).click()
    const guard = page.getByTestId('unsaved-changes-dialog')
    await expect(guard).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await guard.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
    await expect(input).toHaveValue('مسودة قسم باقية')
    await expect(page.getByRole('link', { name: 'العودة إلى مهامي', exact: true })).toBeFocused()
  })
}

test('a failed conversion source is retryable instead of masquerading as no projects', async ({ page }) => {
  await fakeApi(page)
  await page.route('**/api/v1/my-tasks/convert-targets**', route => route.fulfill({ status: 500, json: { code: 'internal', message: 'تعذر تحميل المشاريع' } }))
  await enterFoundation(page, '/my-tasks/8')
  await page.getByRole('button', { name: 'المزيد', exact: true }).click()
  await page.getByRole('menuitem', { name: 'تحويل إلى مهمة مشروع', exact: true }).click()
  const panel = page.getByTestId('my-task-convert')
  await expect(panel.locator('[data-slot="error-state"]')).toBeVisible({ timeout: 10000 })
  await expect(panel.getByRole('button', { name: 'إعادة المحاولة', exact: true })).toBeVisible()
})

test('an unsent comment explains why completion waits for the draft', async ({ page }) => {
  await fakeApi(page)
  await enterFoundation(page, '/my-tasks/7')
  await page.getByPlaceholder('اكتب تعليقًا').fill('تعليق لم يرسل')
  await expect(page.getByRole('button', { name: 'إنجاز', exact: true })).toBeDisabled({ timeout: 5000 })
  await expect(page.getByText('أرسل المسودة أو امسحها قبل تغيير حالة المهمة.', { exact: true })).toBeVisible()
})

test('conversion resolves an unsent comment before any irreversible request', async ({ page }) => {
  const api = await fakeApi(page)
  await enterFoundation(page, '/my-tasks/8')
  await page.getByPlaceholder('اكتب تعليقًا').fill('تعليق قيد الكتابة')
  await page.getByRole('button', { name: 'المزيد', exact: true }).click()
  await page.getByRole('menuitem', { name: 'تحويل إلى مهمة مشروع', exact: true }).click()
  const panel = page.getByTestId('my-task-convert')
  await panel.getByRole('button', { name: 'المشروع', exact: true }).click()
  await page.getByRole('option', { name: 'مشروع الأتمتة', exact: true }).click()
  await panel.getByRole('button', { name: 'تحويل المهمة', exact: true }).click()
  await expect(panel.getByText('سيتم تجاهل النصوص غير المرسلة عند تأكيد التحويل.', { exact: true })).toBeVisible({ timeout: 5000 })
  expect(api.writes()).toHaveLength(0)
  await panel.getByRole('button', { name: 'متابعة الكتابة', exact: true }).click()
  await expect(page.getByPlaceholder('اكتب تعليقًا')).toHaveValue('تعليق قيد الكتابة')
  await expect(page.getByPlaceholder('اكتب تعليقًا')).toBeFocused()
  expect(api.writes()).toHaveLength(0)
})

test('opening conversion on a phone moves focus to its project picker', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fakeApi(page)
  await enterFoundation(page, '/my-tasks/8')
  await page.getByRole('button', { name: 'المزيد', exact: true }).click()
  await page.getByRole('menuitem', { name: 'تحويل إلى مهمة مشروع', exact: true }).click()
  await expect(page.getByTestId('my-task-convert').getByRole('button', { name: 'المشروع', exact: true })).toBeFocused({ timeout: 5000 })
})

test('conversion with explicit draft discard sends once and leaves without a second guard', async ({ page }) => {
  const api = await fakeApi(page, { convertHref: '/projects/1/tasks/9', writeDelayMs: 250 })
  await enterFoundation(page, '/my-tasks/8')
  await page.getByPlaceholder('اكتب تعليقًا').fill('مسودة سيجري تجاهلها')
  await page.getByRole('button', { name: 'المزيد', exact: true }).click()
  await page.getByRole('menuitem', { name: 'تحويل إلى مهمة مشروع', exact: true }).click()
  const panel = page.getByTestId('my-task-convert')
  await panel.getByRole('button', { name: 'المشروع', exact: true }).click()
  await page.getByRole('option', { name: 'مشروع الأتمتة', exact: true }).click()
  await panel.getByRole('button', { name: 'تحويل المهمة', exact: true }).click()
  await panel.getByRole('button', { name: 'تجاهل المسودة والتحويل', exact: true }).dblclick()
  await expect(page).toHaveURL(/\/projects\/1\/tasks\/9$/)
  expect(api.writes().filter(write => write.path === '/8/convert')).toHaveLength(1)
  await expect(page.getByTestId('unsaved-changes-dialog')).toHaveCount(0)
})

test('subtask completion progress follows confirmed child states', async ({ page }) => {
  await fakeApi(page)
  await enterFoundation(page, '/my-tasks/7')
  const progress = page.getByTestId('my-task-subtasks-progress')
  await expect(progress).toHaveText('0 من 1 منجزة', { timeout: 4000 })
  await page.getByRole('button', { name: 'إنجاز: اطبع القائمة', exact: true }).click()
  await expect(progress).toHaveText('1 من 1 منجزة')
})

test('an invalid direct editor id shows not found with a usable list return', async ({ page }) => {
  await enterFoundation(page, '/my-tasks/invalid/edit')
  await expect(page.locator('[data-slot="not-found-state"]')).toBeVisible({ timeout: 4000 })
  await expect(page.getByRole('link', { name: 'العودة إلى مهامي', exact: true })).toHaveAttribute('href', '/my-tasks')
})

test('empty search recovery waits for hydration before accepting its first click', async ({ page }) => {
  await enterFoundation(page, '/my-tasks')
  let resume!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve })
  await page.route('**/_nuxt/**', async route => {
    if (route.request().resourceType() === 'script') await gate
    await route.continue()
  })
  await page.goto('/my-tasks?q=zz-no-match', { waitUntil: 'commit' })
  const clear = page.getByRole('button', { name: 'مسح الفلاتر', exact: true }).last()
  try { await expect(clear).toBeDisabled({ timeout: 4000 }) } finally { resume() }
  await expect(clear).toBeEnabled()
  await clear.click()
  await expect(page).toHaveURL(/\/my-tasks$/)
})

test('background refresh preserves the edit baseline and dirty values', async ({ page }) => {
  const api = await fakeApi(page)
  await enterFoundation(page, '/my-tasks/7/edit')
  await page.getByLabel('عنوان المهمة', { exact: true }).fill('مسودة محلية')
  api.tasks.get(7)!.description = 'وصف تغير بالخادم'
  const before = api.calls.filter(call => call.method === 'GET' && call.path === '/7').length
  await page.clock.install()
  await page.clock.fastForward(6000)
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => api.calls.filter(call => call.method === 'GET' && call.path === '/7').length).toBeGreaterThan(before)
  await expect(page.getByLabel('عنوان المهمة', { exact: true })).toHaveValue('مسودة محلية')
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click()
  await expect(page).toHaveURL(/\/my-tasks\/7$/)
  expect(api.writes().map(call => call.body)).toEqual([{ name: 'مسودة محلية' }])
})

test('a transport failure retains the edit draft for manual retry', async ({ page }) => {
  const api = await fakeApi(page)
  let attempts = 0
  await page.route('**/api/v1/my-tasks/7', route => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    attempts++
    return attempts === 1 ? route.abort('connectionfailed') : route.fallback()
  })
  await enterFoundation(page, '/my-tasks/7/edit')
  const title = page.getByLabel('عنوان المهمة', { exact: true })
  await title.fill('مسودة بلا اتصال')
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click()
  await expect(page.getByRole('alert').first()).toBeVisible()
  await expect(title).toHaveValue('مسودة بلا اتصال')
  expect(attempts).toBe(1)
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click()
  await expect(page).toHaveURL(/\/my-tasks\/7$/)
  expect(attempts).toBe(2)
  expect(api.writes()).toHaveLength(1)
})

for (const navigation of ['browser', 'parameter'] as const) {
  test(`pending comment protects ${navigation} navigation with one guard`, async ({ page }) => {
    const api = await fakeApi(page)
    await enterFoundation(page, '/my-tasks')
    await page.evaluate(() => (window as any).useNuxtApp().$router.push('/my-tasks/7'))
    await expect(page.getByPlaceholder('اكتب تعليقًا')).toBeEnabled()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/v1/my-tasks/7/comments', async route => {
      if (route.request().method() === 'POST') await gate
      await route.fallback()
    })
    const input = page.getByPlaceholder('اكتب تعليقًا')
    await input.fill('تعليق ينتظر الإقرار')
    await page.getByRole('button', { name: 'نشر التعليق', exact: true }).click()
    await expect(page.getByText('جار تنفيذ إجراء. انتظر نتيجته؛ مغادرة الصفحة لا تعني إلغاءه على الخادم.', { exact: true })).toBeVisible()
    if (navigation === 'browser') await page.goBack()
    else await page.evaluate(() => (window as any).useNuxtApp().$router.push('/my-tasks/8'))
    const guard = page.getByTestId('unsaved-changes-dialog')
    await expect(guard).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await guard.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
    await expect(input).toHaveValue('تعليق ينتظر الإقرار')
    await expect(page).toHaveURL(/\/my-tasks\/7$/)
    release()
    await expect(input).toHaveValue('')
    expect(api.writes().filter(call => call.path === '/7/comments')).toHaveLength(1)
  })
}

test('the editor supports Tab Shift Tab and Enter without a duplicate save', async ({ page }) => {
  const api = await fakeApi(page)
  await enterFoundation(page, '/my-tasks/7/edit')
  const title = page.getByLabel('عنوان المهمة', { exact: true })
  await title.focus()
  await title.fill('حفظ بلوحة المفاتيح')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox', { name: 'الوصف', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(title).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/my-tasks\/7$/)
  expect(api.writes().map(call => call.body)).toEqual([{ name: 'حفظ بلوحة المفاتيح' }])
  await page.getByRole('button', { name: 'المزيد', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'المزيد', exact: true })).toBeFocused()
})

test.describe('touch targets', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test('personal record controls retain 44px targets with a coarse pointer', async ({ page }) => {
    await fakeApi(page)
    await enterFoundation(page, '/my-tasks/7')
    for (const control of [page.getByRole('button', { name: 'إنجاز', exact: true }), page.getByRole('link', { name: 'تعديل', exact: true }), page.getByRole('button', { name: 'المزيد', exact: true }), page.getByRole('button', { name: 'إضافة مهمة فرعية', exact: true })]) {
      await expect(control).toBeVisible()
      const rect = await control.boundingBox()
      expect(rect!.height).toBeGreaterThanOrEqual(44)
      expect(rect!.width).toBeGreaterThanOrEqual(44)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  })
})
