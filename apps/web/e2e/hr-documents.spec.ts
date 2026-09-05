import { test, expect } from '@playwright/test'

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

test('HR document routes create, edit, reload, and preserve attachments', async ({ page }) => {
  await login(page)

  const departmentName = `E2E document department ${Date.now()}`
  const departmentResponse = await page.request.post('/api/v1/hr/departments', { data: { name: departmentName } })
  expect(departmentResponse.status()).toBe(201)
  const department = await departmentResponse.json()
  const title = `E2E document ${Date.now()}`
  const body = `E2E document body ${Date.now()}`

  await page.goto(`/hr/departments/${department.id}/documents/new`)
  await expect(page.getByRole('heading', { name: 'مستند جديد' }).first()).toBeVisible()
  await page.getByLabel('عنوان المستند').fill(title)
  await page.getByRole('button', { name: 'إنشاء' }).click()
  await expect(page).toHaveURL(new RegExp(`/hr/departments/${department.id}/documents/\\d+(?:\\?|$)`))

  const documents = await (await page.request.get(`/api/v1/hr/documents?department_id=${department.id}`)).json()
  const created = (documents.items as Array<{ id: number; name: string }>).find((item) => item.name === title)
  expect(created).toBeTruthy()
  const documentId = created.id
  const filename = `e2e-${Date.now()}.txt`
  await page.goto(`/hr/departments/${department.id}/documents/${documentId}/edit`)
  const editorPage = page.locator('form')
  await editorPage.getByRole('textbox', { name: 'المحتوى' }).click()
  await editorPage.getByRole('textbox', { name: 'المحتوى' }).fill(body)
  await editorPage.getByLabel('رفع ملف').setInputFiles({
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from('HR attachment'),
  })
  await expect(editorPage.getByRole('link', { name: filename })).toBeVisible()
  await editorPage.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/hr/departments/${department.id}/documents/${documentId}$`))

  await page.goto(`/hr/departments/${department.id}/documents/${documentId}`)
  await expect(page).toHaveURL(new RegExp(`/hr/departments/${department.id}/documents/${documentId}$`))
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByRole('link', { name: filename })).toBeVisible()

  await page.goto(`/hr/departments/${department.id}/documents/${documentId}/edit`)
  const editedTitle = `${title} edited`
  await page.getByLabel('العنوان').fill(editedTitle)
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/hr/departments/${department.id}/documents/${documentId}$`))
  await page.reload()
  await expect(page.getByText(editedTitle).first()).toBeVisible()
  await expect(page.getByRole('link', { name: filename })).toBeVisible()

  const saved = await (await page.request.get(`/api/v1/hr/documents/${documentId}`)).json()
  expect(saved.name).toBe(editedTitle)
  expect((saved.attachment_ids as Array<{ name: string }>).some((attachment) => attachment.name === filename)).toBe(true)
})
