import { test, expect } from '@playwright/test'

test('department hierarchy keeps routed edits, parent exclusions and reload filters', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })
  expect(login.ok()).toBe(true)
  const suffix = Date.now()
  const parentResponse = await page.request.post('/api/v1/hr/departments', { data: { name: `هيكل ${suffix}` } })
  expect(parentResponse.ok()).toBe(true)
  const parent = await parentResponse.json()
  const childResponse = await page.request.post('/api/v1/hr/departments', { data: { name: `فرع ${suffix}`, parent_id: parent.id } })
  expect(childResponse.ok()).toBe(true)
  const child = await childResponse.json()
  await page.goto(`/hr/departments?view=tree&q=${suffix}`)
  const parentButton = page.getByRole('button', { name: new RegExp(`^${parent.name}`) })
  await expect(parentButton).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(`^${child.name}`) })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: new RegExp(`^${child.name}`) })).toBeVisible()
  await parentButton.click()
  await expect(page).toHaveURL(new RegExp(`/hr/departments/${parent.id}\\?`))
  await page.goto(`/hr/departments/${parent.id}/edit?returnTo=${encodeURIComponent(`/hr/departments?view=tree&q=${suffix}`)}`)
  const parentPicker = page.getByRole('combobox', { name: 'القسم الأب', exact: true })
  await expect(parentPicker).toBeEnabled()
  await parentPicker.click()
  await expect(page.getByRole('option', { name: child.name, exact: true })).toHaveCount(0)
  await expect(page.getByRole('option', { name: parent.name, exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('direct department employee links preserve scope through reload', async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).ok()).toBe(true)
  const suffix = Date.now()
  const deptRes = await page.request.post('/api/v1/hr/departments', { data: { name: `فلتر ${suffix}` } })
  expect(deptRes.status()).toBe(201)
  const department = await deptRes.json()
  const included = `داخل ${suffix}`
  const excluded = `خارج ${suffix}`
  for (const [name, department_id] of [[included, department.id], [excluded, null]]) {
    expect((await page.request.post('/api/v1/hr/employees', { data: { name, department_id } })).status()).toBe(201)
  }
  await page.goto(`/hr?department_id=${department.id}&q=${suffix}`)
  for (let pass = 0; pass < 2; pass++) {
    await expect(page.getByRole('row', { name: new RegExp(included) })).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(excluded) })).toHaveCount(0)
    expect(new URL(page.url()).searchParams.get('department_id')).toBe(String(department.id))
    if (pass === 0) await page.reload()
  }
  await page.getByPlaceholder('بحث بالاسم…').fill(`no-match-${suffix}`)
  const empty = page.getByRole('status').filter({ hasText: 'لا موظفون يطابقون الفلاتر' })
  await expect(empty).toBeVisible()
  await empty.getByRole('button', { name: 'مسح الفلاتر' }).click()
  await expect(page.getByPlaceholder('بحث بالاسم…')).toHaveValue('')
  await expect.poll(() => new URL(page.url()).searchParams.has('department_id')).toBe(false)
})
