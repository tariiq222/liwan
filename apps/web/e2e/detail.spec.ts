import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL('http://localhost:3000/')
}

async function createTask(page, name: string) {
  const projects = await (await page.request.get('/api/v1/projects?minimal=1')).json()
  const res = await page.request.post('/api/v1/tasks', { data: { name, project_id: projects[0].id } })
  return (await res.json()).id as number
}

test('task detail modal: open, edit fields, nested layers, prev/next, close', async ({ page }) => {
  await login(page)
  const name = `E2E detail ${Date.now()}`
  const id = await createTask(page, name)

  // 1. direct route load
  await page.goto(`/tasks/${id}`)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const titleInput = dialog.getByRole('textbox', { name: 'عنوان المهمة' })
  await expect(titleInput).toHaveValue(name)
  await expect(page).toHaveURL(new RegExp(`/tasks/${id}$`))

  // 2. title edit, saves on Enter, persists across reload and in the row behind it
  const newName = `${name}-edited`
  await titleInput.fill(newName)
  const titleSaved = page.waitForResponse((r) => r.url().includes(`/api/v1/tasks/${id}`) && r.request().method() === 'PATCH')
  await titleInput.press('Enter')
  await titleSaved
  await page.reload()
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'عنوان المهمة' })).toHaveValue(newName)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByRole('row', { name: new RegExp(newName) })).toBeVisible()

  // re-open for the rest of the flow
  await page.goto(`/tasks/${id}`)

  // 3. priority
  await page.getByRole('combobox').filter({ hasText: /عادية|مهمة|عالية|عاجلة/ }).first().click()
  await page.getByRole('option', { name: 'عاجلة' }).click()
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
  const subtaskRow = page.getByRole('dialog').getByText('مهمة فرعية تجريبية')
  await expect(subtaskRow).toBeVisible()
  await subtaskRow.click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${subtaskId}$`))

  // go back to the parent task
  await page.goto(`/tasks/${id}`)

  // 6. metrics
  await expect(page.getByText('العمر')).toBeVisible()

  // 7. nested layer: deadline popover + calendar must not dismiss the dialog,
  // and picking a day must actually update the deadline badge (not just leave
  // the dialog open with the old value)
  const deadlineBadge = page.getByRole('dialog').getByTestId('deadline-badge')
  const deadlineBefore = (await deadlineBadge.textContent()) ?? ''
  await page.getByRole('button', { name: 'الموعد' }).click()
  // any in-month day that isn't today, so the deadline is guaranteed to change
  const calendarDay = page.locator('[data-slot="calendar-cell-trigger"]:not([data-today]):not([data-outside-view])').first()
  const deadlineSaved = page.waitForResponse((r) => r.url().includes(`/api/v1/tasks/${id}`) && r.request().method() === 'PATCH')
  await calendarDay.click()
  await deadlineSaved
  await expect(page.getByRole('dialog', { name: 'التفاصيل' })).toBeVisible()
  await expect(deadlineBadge).not.toHaveText(deadlineBefore)

  // 8. prev/next
  const stamp = Date.now()
  const nameA = `E2E siblings A ${stamp}`
  const nameB = `E2E siblings B ${stamp}`
  const idA = await createTask(page, nameA)
  const idB = await createTask(page, nameB)
  await page.goto('/tasks')
  await page.getByPlaceholder('بحث في العناوين…').fill(`E2E siblings ${stamp}`)
  // The list's default sort ties on date_deadline/priority for both (neither
  // set), so the API's `id desc` tiebreak puts the more-recently-created
  // idB first and idA second — open the first row and go `j` (next) to idA.
  const rowB = page.getByRole('row', { name: nameB })
  await rowB.click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${idB}$`))
  await page.keyboard.press('j')
  await expect(page).toHaveURL(new RegExp(`/tasks/${idA}$`))

  // 9. close
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByRole('table')).toBeVisible()
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
  const name1 = `E2E flush 1 ${stamp}`
  const name2 = `E2E flush 2 ${stamp}`
  const id1 = await createTask(page, name1)
  await createTask(page, name2)

  await page.goto('/tasks')
  await page.getByPlaceholder('بحث في العناوين…').fill(`E2E flush ${stamp}`)
  await page.getByRole('row', { name: name1 }).click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${id1}$`))

  const editor = page.getByRole('textbox', { name: 'الوصف' })
  await editor.click()
  const text = 'نص لم يُحفظ بعد'
  await editor.type(text)

  // Still well within the 800ms debounce window: leave immediately via
  // whichever prev/next button is enabled for this task's position in the
  // (two-item) filtered list.
  const dialog = page.getByRole('dialog')
  const nextBtn = dialog.getByRole('button', { name: 'التالية' })
  const prevBtn = dialog.getByRole('button', { name: 'السابقة' })
  if (await nextBtn.isEnabled()) await nextBtn.click()
  else await prevBtn.click()
  await expect(page).not.toHaveURL(new RegExp(`/tasks/${id1}$`))

  // Reload the original task directly and confirm the edit reached the server.
  await page.goto(`/tasks/${id1}`)
  await expect(page.getByRole('textbox', { name: 'الوصف' })).toContainText(text)
})
