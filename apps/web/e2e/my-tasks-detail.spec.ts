import { fakeApi, login } from './support/myTaskApi'
import { expect as baseExpect, test, type Locator, type Page } from '@playwright/test'

// Isolated stack only: not in ci-mock-specs.txt because the shared mock's /me does not know the tasks
// application. Run it behind the wrapper e2e/my-tasks-mock.mjs (see docs/testing.md):
//   E2E_MY_TASKS=1 E2E_BASE_URL=http://localhost:<nuxt> npx playwright test e2e/my-tasks-detail.spec.ts
// The wrapper serves the first paint from my-tasks-fixtures.mjs; every browser call to /api/v1/my-tasks is faked here.
test.skip(process.env.E2E_MY_TASKS !== '1', 'Requires the isolated e2e/my-tasks-mock.mjs server (E2E_MY_TASKS=1)')
test.describe.configure({ timeout: 60_000 })
// Controls stay disabled until hydration; a busy machine hydrates slowly.
const expect = baseExpect.configure({ timeout: 15_000 })

async function openAction(page: Page, label: string) {
  await page.getByRole('button', { name: 'المزيد', exact: true }).click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}

test.beforeEach(async ({ page }) => { await login(page) })

test('detail renders and the edit page PATCHes exactly the changed fields once', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/7')
  await expect(page.getByRole('heading', { name: 'اشترِ الورق', level: 1 })).toBeVisible()
  await expect(page.getByTestId('my-task-state')).toHaveText('مفتوحة')
  await expect(page.getByText('ورق A4 للطابعة')).toBeVisible()

  await page.getByRole('link', { name: 'تعديل', exact: true }).click()
  await page.getByLabel('عنوان المهمة', { exact: true }).fill('اشترِ ورقًا ملونًا')
  await page.getByRole('combobox', { name: 'الأولوية', exact: true }).click()
  await page.getByRole('option', { name: 'مرتفعة' }).click()
  await page.getByRole('button', { name: 'حفظ التغييرات' }).click()

  await expect(page.getByRole('heading', { name: 'اشترِ ورقًا ملونًا', level: 1 })).toBeVisible()
  const patches = api.writes().filter(call => call.method === 'PATCH')
  expect(patches).toHaveLength(1)
  expect(patches[0]!.body).toEqual({ name: 'اشترِ ورقًا ملونًا', priority: 'high' })
  await expect(page.getByTestId('my-task-priority')).toHaveText('مرتفعة')
})

test('clearing the deadline sends null and an empty edit sends nothing', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/7')
  await page.getByRole('link', { name: 'تعديل', exact: true }).click()
  await page.getByRole('button', { name: 'حفظ التغييرات' }).click()
  await expect(page.getByRole('link', { name: 'تعديل', exact: true })).toBeVisible()
  expect(api.writes()).toHaveLength(0)

  await page.getByRole('link', { name: 'تعديل', exact: true }).click()
  await page.getByRole('button', { name: /الموعد النهائي/ }).click()
  await page.getByRole('button', { name: 'مسح التاريخ' }).click()
  await page.getByRole('button', { name: 'حفظ التغييرات' }).click()
  await expect(page.getByTestId('my-task-deadline')).toHaveText('بلا موعد')
  expect(api.writes().map(call => call.body)).toEqual([{ date_deadline: null }])
})

test('a field error from the server is shown next to the field', async ({ page }) => {
  await fakeApi(page)
  await page.route('**/api/v1/my-tasks/7', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'invalid', message: 'العنوان طويل جدًا', field: 'name' }) })
  })
  await page.goto('/my-tasks/7')
  await page.getByRole('link', { name: 'تعديل', exact: true }).click()
  await page.getByLabel('عنوان المهمة', { exact: true }).fill('عنوان جديد')
  await page.getByRole('button', { name: 'حفظ التغييرات' }).click()
  await expect(page.getByText('العنوان طويل جدًا')).toBeVisible()
})

test('mark done follows the server answer and reopen becomes available', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/7')
  await expect(page.getByRole('button', { name: 'إعادة فتح', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'إنجاز', exact: true }).click()
  await expect(page.getByTestId('my-task-state')).toHaveText('منجزة')
  await expect(page.getByRole('button', { name: 'إنجاز', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'إعادة فتح', exact: true })).toBeVisible()
  expect(api.writes().map(call => call.path)).toEqual(['/7/done'])

  await page.getByRole('button', { name: 'إعادة فتح', exact: true }).click()
  await expect(page.getByTestId('my-task-state')).toHaveText('مفتوحة')
  await expect(page.getByRole('button', { name: 'إنجاز', exact: true })).toBeVisible()
})

test('cancel asks inline first and sends nothing until confirmed', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/7')
  await openAction(page, 'إلغاء المهمة')
  const confirm = page.getByTestId('inline-confirm')
  await expect(confirm).toContainText('إلغاء هذه المهمة؟')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(api.writes()).toHaveLength(0)

  await confirm.getByRole('button', { name: 'إبقاء المهمة' }).click()
  await expect(confirm).toHaveCount(0)
  expect(api.writes()).toHaveLength(0)

  await openAction(page, 'إلغاء المهمة')
  await page.getByTestId('inline-confirm-action').click()
  await expect(page.getByTestId('my-task-state')).toHaveText('ملغاة')
  expect(api.writes().map(call => call.path)).toEqual(['/7/cancel'])
})

test('sub-tasks: add by name and toggle done; a sub-task page links to its parent and has no sub-tasks', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/7')
  const section = page.getByTestId('my-task-subtasks')
  await expect(section.getByRole('link', { name: 'اطبع القائمة' })).toHaveAttribute('href', /\/my-tasks\/11/)

  await section.getByLabel('عنوان المهمة الفرعية').fill('اطلب الحبر')
  await section.getByRole('button', { name: 'إضافة مهمة فرعية' }).click()
  await expect(section.getByRole('link', { name: 'اطلب الحبر' })).toBeVisible()
  expect(api.writes()[0]).toEqual({ method: 'POST', path: '/', body: { name: 'اطلب الحبر', parent_id: 7 } })

  await section.getByRole('button', { name: /إنجاز/ }).first().click()
  await expect(section.getByRole('button', { name: /إعادة فتح/ })).toHaveCount(1)
  expect(api.writes().map(call => call.path)).toContain('/11/done')

  await page.goto('/my-tasks/10')
  await expect(page.getByRole('heading', { name: 'اطبع القائمة', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'اشترِ الورق' })).toHaveAttribute('href', /\/my-tasks\/7/)
  await expect(page.getByTestId('my-task-subtasks')).toHaveCount(0)
})

test('a sub-task whose parent the viewer cannot read offers no sub-tasks and no parent link', async ({ page }) => {
  await fakeApi(page)
  await page.goto('/my-tasks/14')
  await expect(page.getByRole('heading', { name: 'مهمة فرعية بأب مخفي', level: 1 })).toBeVisible()
  await expect(page.getByTestId('my-task-subtasks')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'إضافة مهمة فرعية' })).toHaveCount(0)
})

test('a read-only viewer sees the comments but gets no comment form', async ({ page }) => {
  await fakeApi(page)
  await page.goto('/my-tasks/9')
  const section = page.getByTestId('my-task-comments')
  await expect(section).toBeVisible()
  await expect(section.getByLabel('اكتب تعليقًا')).toHaveCount(0)
  await expect(section.getByRole('button', { name: 'نشر التعليق' })).toHaveCount(0)
})

test('comments: post plain text, oldest first, unknown author gets a neutral label', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/12')
  const section = page.getByTestId('my-task-comments')
  await expect(section.getByText('تعليق قديم <b>نص</b>')).toBeVisible()
  await expect(section.getByText('مستخدم غير معروف')).toBeVisible()

  const post = section.getByRole('button', { name: 'نشر التعليق' })
  await expect(post).toBeDisabled()
  await section.getByLabel('اكتب تعليقًا').fill('تم الاتفاق مع المورّد')
  await post.click()
  await expect(section.getByText('تم الاتفاق مع المورّد')).toBeVisible()
  await expect(section.getByLabel('اكتب تعليقًا')).toHaveValue('')
  const items = section.getByRole('listitem')
  await expect(items.first()).toContainText('تعليق قديم')
  await expect(items.last()).toContainText('تم الاتفاق مع المورّد')
  expect(api.writes()).toEqual([{ method: 'POST', path: '/12/comments', body: { body: 'تم الاتفاق مع المورّد' } }])
})

test('attachments: upload, download link, delete only after the inline confirmation', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/7')
  const section = page.getByTestId('my-task-attachments')
  await expect(section.getByText('لا توجد مرفقات')).toBeVisible()

  await expect(section.getByRole('button', { name: 'إضافة مرفق' })).toBeEnabled({ timeout: 15_000 })
  await section.locator('input[type=file]').setInputFiles({ name: 'ملاحظات.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  const link = section.getByRole('link', { name: 'ملاحظات.txt' })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', /\/web\/content\//)
  await expect(section).toContainText('مرفق واحد')
  const upload = api.writes()[0]!
  expect(upload.path).toBe('/7/attachments')
  expect(upload.body).toEqual({ name: 'ملاحظات.txt', mimetype: 'text/plain', data: Buffer.from('hello').toString('base64') })

  await section.getByRole('button', { name: 'حذف المرفق' }).click()
  await expect(section.getByTestId('inline-confirm')).toContainText('حذف هذا المرفق نهائيًا؟')
  expect(api.writes().filter(call => call.method === 'DELETE')).toHaveLength(0)
  await section.getByTestId('inline-confirm-action').click()
  await expect(section.getByText('لا توجد مرفقات')).toBeVisible()
  expect(api.writes().filter(call => call.method === 'DELETE')).toHaveLength(1)
})

test('attachments: a wrong type or an oversized file is refused before any request', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/7')
  const section = page.getByTestId('my-task-attachments')
  await expect(section.getByRole('button', { name: 'إضافة مرفق' })).toBeEnabled({ timeout: 15_000 })
  await section.locator('input[type=file]').setInputFiles({ name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') })
  await expect(section.getByRole('alert')).toContainText('نوع الملف غير مسموح')
  await section.locator('input[type=file]').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) })
  await expect(section.getByRole('alert')).toContainText('10 ميغابايت')
  expect(api.writes()).toHaveLength(0)
})

test('convert panel: hidden without the permission, otherwise search, confirm and go to the server href', async ({ page }) => {
  const api = await fakeApi(page, { convertHref: '/projects/1/tasks/9' })
  await page.goto('/my-tasks/7')
  await expect(page.getByRole('heading', { name: 'اشترِ الورق', level: 1 })).toBeVisible()
  await expect(page.getByTestId('my-task-convert')).toHaveCount(0)

  await page.goto('/my-tasks/8')
  await openAction(page, 'تحويل إلى مهمة مشروع')
  const panel = page.getByTestId('my-task-convert')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'المشروع' }).click()
  await page.getByPlaceholder('ابحث عن مشروع').fill('الأتمتة')
  await page.getByRole('option', { name: 'مشروع الأتمتة' }).click()
  await panel.getByRole('button', { name: 'تحويل المهمة' }).click()
  await expect(panel.getByTestId('inline-confirm')).toContainText('لا يمكن التراجع عن هذا التحويل.')
  expect(api.writes()).toHaveLength(0)
  await panel.getByTestId('inline-confirm-action').click()
  await expect(page).toHaveURL(/\/projects\/1\/tasks\/9$/)
  expect(api.writes()).toEqual([{ method: 'POST', path: '/8/convert', body: { project_id: 1 } }])
})

test('an unknown or foreign task shows the not-found state', async ({ page }) => {
  await fakeApi(page)
  await page.goto('/my-tasks/999')
  await expect(page.locator('[data-slot="not-found-state"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('link', { name: 'العودة إلى مهامي' })).toHaveAttribute('href', '/my-tasks')
})

test('the back link honours a safe returnTo and ignores an unsafe one', async ({ page }) => {
  await fakeApi(page)
  await page.goto('/my-tasks/7?returnTo=%2Fmy-tasks%3Ftab%3Ddone%26q%3Dx')
  await expect(page.getByRole('link', { name: 'العودة إلى مهامي' })).toHaveAttribute('href', '/my-tasks?tab=done&q=x')
  await page.goto('/my-tasks/7?returnTo=https%3A%2F%2Fevil.example')
  await expect(page.getByRole('link', { name: 'العودة إلى مهامي' })).toHaveAttribute('href', '/my-tasks')
})

test('first-click safety: every action is disabled until hydration, then the first click lands', async ({ page }) => {
  const api = await fakeApi(page)
  let resume!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve })
  await page.route('**/_nuxt/**', async (route) => {
    if (route.request().resourceType() === 'script') await gate
    await route.continue()
  })
  await page.goto('/my-tasks/7', { waitUntil: 'commit' })
  const done = page.getByRole('button', { name: 'إنجاز', exact: true })
  const cancel = page.getByRole('button', { name: 'المزيد', exact: true })
  const edit = page.getByRole('link', { name: 'تعديل', exact: true })
  const post = page.getByTestId('my-task-comments').getByRole('button', { name: 'نشر التعليق' })
  await expect(done).toBeVisible()
  for (const control of [done, cancel, edit, post]) await expect(control).toBeDisabled()
  resume()
  await expect(done).toBeEnabled()
  await done.click()
  await expect(page.getByTestId('my-task-state')).toHaveText('منجزة')
  expect(api.writes().map(call => call.path)).toEqual(['/7/done'])
})

// Two clicks in the same task: `isPending` of the mutation only reaches the guards on a later
// macrotask, so only a synchronous in-flight flag keeps the second click from a second request.
async function clickTwice(locator: Locator) {
  await expect(locator).toBeEnabled({ timeout: 15_000 })
  await locator.evaluate((element: HTMLElement) => { element.click(); element.click() })
}

test.describe('a double click sends exactly one write', () => {
  test('post comment', async ({ page }) => {
    const api = await fakeApi(page, { writeDelayMs: 600 })
    await page.goto('/my-tasks/7')
    const section = page.getByTestId('my-task-comments')
    await expect(section.getByLabel('اكتب تعليقًا')).toBeEnabled({ timeout: 15_000 })
    await section.getByLabel('اكتب تعليقًا').fill('تعليق واحد')
    await clickTwice(section.getByRole('button', { name: 'نشر التعليق' }))
    await expect(section.getByText('تعليق واحد')).toBeVisible()
    expect(api.writes()).toHaveLength(1)
  })

  test('add sub-task', async ({ page }) => {
    const api = await fakeApi(page, { writeDelayMs: 600 })
    await page.goto('/my-tasks/7')
    const section = page.getByTestId('my-task-subtasks')
    await expect(section.getByLabel('عنوان المهمة الفرعية')).toBeEnabled({ timeout: 15_000 })
    await section.getByLabel('عنوان المهمة الفرعية').fill('مهمة فرعية واحدة')
    await clickTwice(section.getByRole('button', { name: 'إضافة مهمة فرعية' }))
    await expect(section.getByRole('link', { name: 'مهمة فرعية واحدة' })).toBeVisible()
    expect(api.writes()).toHaveLength(1)
  })

  test('done', async ({ page }) => {
    const api = await fakeApi(page, { writeDelayMs: 600 })
    await page.goto('/my-tasks/7')
    await clickTwice(page.getByRole('button', { name: 'إنجاز', exact: true }))
    await expect(page.getByTestId('my-task-state')).toHaveText('منجزة')
    expect(api.writes().map(call => call.path)).toEqual(['/7/done'])
  })

  test('cancel confirmation', async ({ page }) => {
    const api = await fakeApi(page, { writeDelayMs: 600 })
    await page.goto('/my-tasks/7')
    await openAction(page, 'إلغاء المهمة')
    await clickTwice(page.getByTestId('inline-confirm-action'))
    await expect(page.getByTestId('my-task-state')).toHaveText('ملغاة')
    expect(api.writes().map(call => call.path)).toEqual(['/7/cancel'])
  })

  test('convert confirmation', async ({ page }) => {
    const api = await fakeApi(page, { writeDelayMs: 600 })
    await page.goto('/my-tasks/8')
  await openAction(page, 'تحويل إلى مهمة مشروع')
    const panel = page.getByTestId('my-task-convert')
    await expect(panel.getByRole('button', { name: 'المشروع' })).toBeEnabled()
    await panel.getByRole('button', { name: 'المشروع' }).click()
    await page.getByRole('option', { name: 'مشروع الأتمتة' }).click()
    await panel.getByRole('button', { name: 'تحويل المهمة' }).click()
    await clickTwice(panel.getByTestId('inline-confirm-action'))
    await expect(page).toHaveURL(/\/projects\/1\/tasks\/9$/)
    expect(api.writes().map(call => call.path)).toEqual(['/8/convert'])
  })

  test('attachment upload and delete confirmation', async ({ page }) => {
    const api = await fakeApi(page, { writeDelayMs: 600 })
    await page.goto('/my-tasks/7')
    const section = page.getByTestId('my-task-attachments')
    await expect(section.getByRole('button', { name: 'إضافة مرفق' })).toBeEnabled({ timeout: 15_000 })
    const input = section.locator('input[type=file]')
    // Two change events in the same task: the second one must not start a second upload.
    await input.evaluate((element: HTMLInputElement) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['hello'], 'a.txt', { type: 'text/plain' }))
      element.files = transfer.files
      element.dispatchEvent(new Event('change', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect(section.getByRole('link', { name: 'a.txt' })).toBeVisible()
    expect(api.writes().filter(call => call.method === 'POST')).toHaveLength(1)

    await section.getByRole('button', { name: 'حذف المرفق' }).click()
    await clickTwice(section.getByTestId('inline-confirm-action'))
    await expect(section.getByText('لا توجد مرفقات')).toBeVisible()
    expect(api.writes().filter(call => call.method === 'DELETE')).toHaveLength(1)
  })
})

test('focus follows the control that replaces the one just used', async ({ page }) => {
  await fakeApi(page)
  await page.goto('/my-tasks/7')
  await expect(page.getByRole('button', { name: 'إنجاز', exact: true })).toBeEnabled()
  await expect(page.getByTestId('my-task-state-live')).toHaveAttribute('aria-live', 'polite')

  await openAction(page, 'إلغاء المهمة')
  await expect(page.getByTestId('inline-confirm-cancel')).toBeFocused()
  await page.getByTestId('inline-confirm-cancel').click()
  await expect(page.getByRole('button', { name: 'المزيد', exact: true })).toBeFocused()

  await page.getByRole('button', { name: 'إنجاز', exact: true }).click()
  await expect(page.getByRole('button', { name: 'إعادة فتح', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'إعادة فتح', exact: true }).click()
  await expect(page.getByRole('button', { name: 'إنجاز', exact: true })).toBeFocused()

  await openAction(page, 'إلغاء المهمة')
  await page.getByTestId('inline-confirm-action').click()
  await expect(page.getByTestId('my-task-state')).toHaveText('ملغاة')
  // Nothing primary is left but «reopen»: it takes the focus.
  await expect(page.getByRole('button', { name: 'إعادة فتح', exact: true })).toBeFocused()
})

test('a failed attachment delete says so specifically', async ({ page }) => {
  await fakeApi(page)
  await page.route('**/api/v1/my-tasks/7/attachments/**', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })
  await page.goto('/my-tasks/7')
  const section = page.getByTestId('my-task-attachments')
  await expect(section.getByRole('button', { name: 'إضافة مرفق' })).toBeEnabled({ timeout: 15_000 })
  await section.locator('input[type=file]').setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x') })
  await section.getByRole('button', { name: 'حذف المرفق' }).click()
  await section.getByTestId('inline-confirm-action').click()
  await expect(section.getByRole('alert').filter({ hasText: 'تعذر حذف المرفق' })).toBeVisible()
})

for (const timezoneId of ['America/Argentina/Buenos_Aires', 'Pacific/Kiritimati']) {
  test.describe(`deadline day does not shift in ${timezoneId}`, () => {
    test.use({ timezoneId })

    test('midnight UTC renders as 13 October and an edit sends the date only', async ({ page }) => {
      const api = await fakeApi(page)
      await page.goto('/my-tasks/13')
      await expect(page.getByTestId('my-task-deadline')).toHaveText(/13\W+10\W+2026/)

      await page.goto('/my-tasks/7')
      await page.getByRole('link', { name: 'تعديل', exact: true }).click()
      await page.getByRole('button', { name: /الموعد النهائي/ }).click()
      await page.locator('[data-value="2026-10-13"]').first().click()
      await page.getByRole('button', { name: 'حفظ التغييرات' }).click()
      await expect(page.getByTestId('my-task-deadline')).toHaveText(/13\W+10\W+2026/)
      expect(api.writes().map(call => call.body)).toEqual([{ date_deadline: '2026-10-13' }])
    })
  })
}

// Visual proof only: E2E_MY_TASKS_SHOTS=<absolute dir> writes the screenshots, otherwise skipped.
test('screenshots of the detail page (desktop and mobile, RTL)', async ({ page }) => {
  test.skip(!process.env.E2E_MY_TASKS_SHOTS, 'set E2E_MY_TASKS_SHOTS to a directory')
  const dir = process.env.E2E_MY_TASKS_SHOTS!
  await fakeApi(page)
  for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(size)
    await page.goto('/my-tasks/7')
    await expect(page.getByRole('button', { name: 'إنجاز', exact: true })).toBeEnabled()
    await page.screenshot({ path: `${dir}/detail-open-${name}.png`, fullPage: true })
    await openAction(page, 'إلغاء المهمة')
    await expect(page.getByTestId('inline-confirm')).toBeVisible()
    await page.screenshot({ path: `${dir}/detail-cancel-confirm-${name}.png`, fullPage: true })
    await page.goto('/my-tasks/9')
    await expect(page.getByRole('button', { name: 'إعادة فتح', exact: true })).toBeEnabled()
    await page.screenshot({ path: `${dir}/detail-done-${name}.png`, fullPage: true })
    await page.goto('/my-tasks/8')
  await openAction(page, 'تحويل إلى مهمة مشروع')
    await expect(page.getByRole('button', { name: 'المشروع' })).toBeEnabled()
    await page.getByRole('button', { name: 'المشروع' }).click()
    await page.getByRole('option', { name: 'مشروع الأتمتة' }).click()
    await page.getByRole('button', { name: 'تحويل المهمة' }).click()
    await expect(page.getByTestId('my-task-convert').getByTestId('inline-confirm')).toBeVisible()
    await page.screenshot({ path: `${dir}/detail-convert-${name}.png`, fullPage: true })
    await page.goto('/my-tasks/7')
    await page.getByRole('link', { name: 'تعديل', exact: true }).click()
    await expect(page.getByRole('button', { name: 'حفظ التغييرات' })).toBeEnabled()
    await page.screenshot({ path: `${dir}/detail-edit-${name}.png`, fullPage: true })
  }
})
