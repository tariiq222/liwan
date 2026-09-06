import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

async function createTask(page, name: string) {
  const projects = await (await page.request.get('/api/v1/projects?minimal=1')).json()
  const res = await page.request.post('/api/v1/tasks', { data: { name, project_id: projects[0].id } })
  return (await res.json()).id as number
}

test('task detail page: open, edit fields, nested layers, prev/next, return', async ({ page }) => {
  await login(page)
  const name = `E2E detail ${Date.now()}`
  const id = await createTask(page, name)

  // 1. direct route load
  await page.goto(`/tasks/${id}`)
  const detail = page.getByTestId('task-detail-page')
  await expect(detail).toBeVisible()
  await detail.getByTestId('task-title-edit').click()
  const titleInput = detail.getByRole('textbox', { name: 'عنوان المهمة' })
  await expect(titleInput).toHaveValue(name)
  await expect(page).toHaveURL(new RegExp(`/tasks/${id}$`))

  // 2. title edit, saves on Enter, persists across reload and in the row behind it
  const newName = `${name}-edited`
  await titleInput.fill(newName)
  const titleSaved = page.waitForResponse((r) => r.url().includes(`/api/v1/tasks/${id}`) && r.request().method() === 'PATCH')
  await titleInput.press('Enter')
  await titleSaved
  await page.reload()
  await expect(page.locator('h1')).toHaveText(newName)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/tasks$/)
  await page.getByPlaceholder('بحث في العناوين…').fill(newName)
  await expect(page.getByRole('row', { name: new RegExp(newName) })).toBeVisible()

  // re-open for the rest of the flow
  await page.goto(`/tasks/${id}`)

  // 3. priority
  await page.getByRole('combobox').filter({ hasText: /عادية|مهمة|عالية|عاجلة/ }).first().click()
  const prioritySaved = page.waitForResponse((r) => r.url().includes(`/api/v1/tasks/${id}`) && r.request().method() === 'PATCH')
  await page.getByRole('option', { name: 'عاجلة' }).click()
  await prioritySaved
  await page.reload()
  await expect(page.getByRole('combobox').filter({ hasText: 'عاجلة' }).first()).toBeVisible()

  // 4. description
  const editor = page.getByRole('textbox', { name: 'الوصف' })
  await editor.click()
  await editor.type('وصف تجريبي للمهمة')
  await page.waitForTimeout(1200)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'الوصف' })).toContainText('وصف تجريبي للمهمة')

  // 5. sub-task — assert the URL lands on the exact id the create response returned,
  // not merely "some other id"
  const subtaskInput = page.getByPlaceholder('إضافة مهمة فرعية')
  await subtaskInput.fill('مهمة فرعية تجريبية')
  const subtaskCreated = page.waitForResponse((r) => r.url().includes('/api/v1/tasks') && r.request().method() === 'POST')
  await subtaskInput.press('Enter')
  const subtaskId = (await (await subtaskCreated).json()).id as number
  const subtaskRow = page.getByTestId('task-detail-page').getByText('مهمة فرعية تجريبية')
  await expect(subtaskRow).toBeVisible()
  await subtaskRow.click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${subtaskId}$`))

  // go back to the parent task
  await page.goto(`/tasks/${id}`)

  // 6. metrics
  await page.locator('summary').filter({ hasText: 'تفاصيل إضافية' }).click()
  await expect(page.getByText('العمر')).toBeVisible()

  // 7. nested layer: deadline popover + calendar must not leave the page,
  // and picking a day must actually update the deadline badge.
  const deadlineBadge = page.getByTestId('task-detail-page').getByTestId('deadline-badge')
  const deadlineBefore = (await deadlineBadge.textContent()) ?? ''
  await page.getByRole('button', { name: 'الموعد' }).click()
  // any in-month day that isn't today, so the deadline is guaranteed to change
  const calendarDay = page.locator('[data-slot="calendar-cell-trigger"]:not([data-today]):not([data-outside-view])').first()
  const deadlineSaved = page.waitForResponse((r) => r.url().includes(`/api/v1/tasks/${id}`) && r.request().method() === 'PATCH')
  await calendarDay.click()
  await deadlineSaved
  await expect(page.getByTestId('task-detail-page')).toBeVisible()
  await expect(deadlineBadge).not.toHaveText(deadlineBefore)

  // 8. prev/next
  // The stamp goes *before* the A/B suffix so the search term below is a real
  // substring of both names: the API filters with `name ilike q`, and the
  // previous "E2E siblings {stamp}" never matched "E2E siblings A {stamp}" —
  // the filtered list was empty and prev/next only worked because the old
  // implementation fell back to scanning every other cached list.
  const stamp = Date.now()
  const prefix = `E2E siblings ${stamp}`
  const nameA = `${prefix} A`
  const nameB = `${prefix} B`
  const idA = await createTask(page, nameA)
  const idB = await createTask(page, nameB)
  await page.goto('/tasks')
  // A matching row may already exist before the 300ms search debounce.
  const filtered = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/tasks' && new URL(r.url()).searchParams.get('q') === prefix)
  await page.getByPlaceholder('بحث في العناوين…').fill(prefix)
  await filtered
  // The list's default sort ties on date_deadline/priority for both (neither
  // set), so the API's `id desc` tiebreak puts the more-recently-created
  // idB first and idA second — open the first row and go `j` (next) to idA.
  const rowB = page.getByRole('row', { name: nameB })
  await rowB.click()
  await expect.poll(() => new URL(page.url()).searchParams.get('returnTo')).toBe('/tasks')
  await expect(page.getByTestId('task-detail-page').getByRole('button', { name: 'التالية' })).toBeEnabled()
  await page.keyboard.press('j')
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/tasks/${idA}`)

  // 9. close
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByRole('table')).toBeVisible()
})

test('task detail uses the shared page title and keeps activity beside the work area', async ({ page }) => {
  await login(page)
  const name = `E2E layout ${Date.now()}`
  const id = await createTask(page, name)

  await page.goto(`/tasks/${id}`)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  const detail = page.getByTestId('task-detail-page')
  await expect(detail.getByRole('heading', { name: 'النشاط' })).toBeVisible()
  await expect(page.locator('h1')).toHaveText(name)
  await expect(page.locator('[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="dialog-overlay"], [data-slot="sheet-overlay"]')).toHaveCount(0)
})

// Code-review regression case: Vue Router/Nuxt can reuse the same
// DescriptionEditor instance across a /tasks/A -> /tasks/B navigation. A
// pending debounced edit from A must be flushed (emitted immediately)
// instead of silently discarded when the instance moves on to B. The test
// stays deterministic by navigating right after typing — no waitForTimeout
// before it — so the assertion only passes if the edit was flushed, never
// because the debounce timer happened to fire in the background.
test('a description edit made just before navigating away is not lost', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  // Stamp before the suffix so the search term is a real substring of both
  // names — see the note in the prev/next step of the test above.
  const prefix = `E2E flush ${stamp}`
  const name1 = `${prefix} 1`
  const name2 = `${prefix} 2`
  const id1 = await createTask(page, name1)
  await createTask(page, name2)

  await page.goto('/tasks')
  // A matching row may already exist before the 300ms search debounce.
  const filtered = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/tasks' && new URL(r.url()).searchParams.get('q') === prefix)
  await page.getByPlaceholder('بحث في العناوين…').fill(prefix)
  await filtered
  await page.getByRole('row', { name: name1 }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('returnTo')).toBe('/tasks')

  const editor = page.getByRole('textbox', { name: 'الوصف' })
  await editor.click()
  const text = 'نص لم يُحفظ بعد'
  await editor.type(text)

  // Still well within the 800ms debounce window: leave immediately via
  // whichever prev/next button is enabled for this task's position in the
  // (two-item) filtered list.
  const detail = page.getByTestId('task-detail-page')
  const nextBtn = detail.getByRole('button', { name: 'التالية' })
  const prevBtn = detail.getByRole('button', { name: 'السابقة' })
  if (await nextBtn.isEnabled()) await nextBtn.click()
  else await prevBtn.click()
  await expect(page).not.toHaveURL(new RegExp(`/tasks/${id1}(?:\\?|$)`))

  // Reload the original task directly and confirm the edit reached the server.
  await page.goto(`/tasks/${id1}`)
  await expect(page.getByRole('textbox', { name: 'الوصف' })).toContainText(text)
})

// Regression: useTaskSiblings used to be a `computed` whose only reactive
// dependencies were the current id and the filter params — it read the list
// out of the query cache with `getQueryData`/`getQueriesData`, which are
// imperative and register no dependency. On a cold direct /tasks/{id} load
// (a shared link) nothing had populated that cache yet, so it evaluated once
// to {prevId: null, nextId: null} and never re-evaluated when the list
// arrived: prev/next and J/K were permanently dead. This test deliberately
// never clicks through the table — `page.goto` straight at the detail route.
test('prev/next is live on a direct /tasks/{id} load', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  const prefix = `E2E direct ${stamp}`
  const idA = await createTask(page, `${prefix} A`)
  const idB = await createTask(page, `${prefix} B`)
  // Seed a bounded persisted filter without visiting the table. The detail
  // route must fetch its own list on this cold navigation, even when the
  // database contains more than one page of higher-priority tasks.
  await page.evaluate(q => localStorage.setItem('nasq.tasks.filters', JSON.stringify({ closed: false, q })), prefix)

  await page.goto(`/tasks/${idB}`)
  const detail = page.getByTestId('task-detail-page')
  await expect(detail).toBeVisible()

  // The sibling list is fetched by the panel itself; wait for it to
  // land by watching prev/next go from "no siblings" to enabled.
  const nextBtn = detail.getByRole('button', { name: 'التالية' })
  await expect(nextBtn).toBeEnabled()

  // Neither task has a deadline, so the default sort falls through to the
  // API's `id desc` tiebreak: the newer idB sits immediately before idA.
  await page.keyboard.press('j')
  await expect(page).toHaveURL(new RegExp(`/tasks/${idA}$`))
})

test('task archive and link editing stay inline on the direct detail page', async ({ page }) => {
  await login(page)
  const id = await createTask(page, `E2E inline detail ${Date.now()}`)
  await page.goto(`/tasks/${id}`)
  const detail = page.getByTestId('task-detail-page')
  await expect(detail).toBeVisible()

  await detail.getByRole('button', { name: 'عنوان الرابط' }).click()
  const linkEditor = detail.getByTestId('link-editor')
  await expect(linkEditor).toBeVisible()
  await expect(page.locator('[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="dialog-overlay"], [data-slot="sheet-overlay"]')).toHaveCount(0)
  await linkEditor.getByPlaceholder('عنوان الرابط').fill('https://example.com')
  await linkEditor.getByRole('button', { name: 'تطبيق الرابط' }).click()
  await expect(linkEditor).toHaveCount(0)

  await detail.getByTestId('task-archive').click()
  const confirmation = detail.getByTestId('task-archive-confirm')
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'إلغاء' }).click()
  await expect(confirmation).toHaveCount(0)
  await detail.getByTestId('task-archive').click()
  const archived = page.waitForResponse((response) => response.url().includes(`/api/v1/tasks/${id}/archive`) && response.request().method() === 'POST')
  await detail.getByTestId('task-archive-confirm').getByRole('button', { name: 'أرشفة المهمة' }).click()
  await archived
  await expect(page).toHaveURL(/\/tasks$/)
})
