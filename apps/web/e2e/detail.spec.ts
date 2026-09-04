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

  // 5. sub-task
  const subtaskInput = page.getByPlaceholder('إضافة مهمة فرعية')
  await subtaskInput.fill('مهمة فرعية تجريبية')
  await subtaskInput.press('Enter')
  const subtaskRow = page.getByRole('dialog').getByText('مهمة فرعية تجريبية')
  await expect(subtaskRow).toBeVisible()
  await subtaskRow.click()
  await expect(page).not.toHaveURL(new RegExp(`/tasks/${id}$`))

  // go back to the parent task
  await page.goto(`/tasks/${id}`)

  // 6. metrics
  await expect(page.getByText('العمر')).toBeVisible()

  // 7. nested layer: deadline popover + calendar must not dismiss the dialog
  await page.getByRole('button', { name: 'الموعد' }).click()
  const calendarDay = page.getByRole('gridcell').filter({ hasNotText: '' }).locator('button').first()
  await calendarDay.click()
  await expect(page.getByRole('dialog', { name: 'التفاصيل' })).toBeVisible()

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
