import { expect, test, type Page } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

test('approved shell keeps one route title and fixed sidebar dimensions', async ({ page }) => {
  await login(page)

  await expect(page.locator('h1')).toHaveCount(1)
  await expect(page.locator('.nasq-app-header h1')).toHaveText(/.+/)
  await expect(page.getByRole('button', { name: 'بحث' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^حسابي/ })).toBeVisible()

  // The outer fixed panel includes the 1px divider; its inner content does not.
  const sidebar = page.locator('[data-slot="sidebar"] > .fixed')
  await expect(sidebar).toHaveCSS('width', '232px')
  await page.locator('[data-slot="sidebar-trigger"]').click()
  await expect(sidebar).toHaveCSS('width', '72px')
})

test('mobile shell places search on its own header row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)

  const title = page.locator('.nasq-header-start')
  const search = page.getByRole('button', { name: 'بحث' })
  await expect(title).toBeVisible()
  await expect(search).toBeVisible()

  const [titleBox, searchBox] = await Promise.all([title.boundingBox(), search.boundingBox()])
  expect(titleBox).not.toBeNull()
  expect(searchBox).not.toBeNull()
  expect(searchBox!.y).toBeGreaterThan(titleBox!.y + titleBox!.height)
})

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`large text keeps routed pages within a ${viewport.width}px viewport in both modes`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await login(page)
    const projectResponse = await page.request.post('/api/v1/projects', { data: { name: `Design layout ${Date.now()}` } })
    expect(projectResponse.ok()).toBeTruthy()
    const project = await projectResponse.json()
    const taskResponse = await page.request.post('/api/v1/tasks', { data: { name: 'مراجعة توزيع عناصر الصفحة مع العنوان الطويل والخط الكبير', project_id: project.id } })
    expect(taskResponse.ok()).toBeTruthy()
    const task = await taskResponse.json()

    for (const mode of ['light', 'dark']) {
      await page.goto('/settings/appearance')
      await page.getByTestId('appearance-font-large').check()
      await page.getByTestId(`appearance-mode-${mode}`).check()
      for (const [name, route] of [['appearance', '/settings/appearance'], ['project', `/projects/${project.id}`], ['task', `/tasks/${task.id}`], ['hr', '/hr']] as const) {
        await page.goto(route)
        // Measure loaded record content, not the shell's initial skeleton.
        if (name === 'task') {
          await expect(page.getByRole('textbox', { name: 'عنوان المهمة' })).toHaveValue(task.name)
          await expect(page.getByRole('textbox', { name: 'الوصف' })).toBeVisible()
        }
        if (name === 'project') await expect(page.locator('h1')).toHaveText(project.name)
        await expect(page.locator('html')).toHaveCSS('font-size', '18px')
        await expect(page.locator('h1')).toHaveCount(1)
        await expect(page.locator('[data-slot="sidebar-trigger"]')).toBeEnabled()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
        await expect(page.locator('[data-slot="sidebar-trigger"]')).toHaveCSS('width', '32px')
        await expect(page.locator('[data-slot="sidebar-trigger"]')).toHaveCSS('height', '32px')
        await page.screenshot({ path: testInfo.outputPath(`${name}-${mode}-${viewport.width}.png`), fullPage: true })
      }
    }
  })
}
