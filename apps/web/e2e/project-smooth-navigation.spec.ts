import { test, expect } from '@playwright/test'
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated project mock only')
test('project sidebar changes content without replaying the whole page entrance', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
  await page.goto('/projects/1?tab=tasks')
  await expect(page.getByTestId('project-tab-governance')).toBeVisible()
  const origin = await page.evaluate(() => performance.timeOrigin)
  await page.evaluate(() => {
    const main = document.querySelector('[data-testid="shell-main"]')!
    main.setAttribute('data-test-animation-count', '0')
    main.addEventListener('animationstart', e => {
      if (e.target === main) main.setAttribute('data-test-animation-count', String(Number(main.getAttribute('data-test-animation-count')) + 1))
    })
  })
  // The project name stays the page's only h1; the active tab names the section.
  for (const id of ['project-tab-governance', 'governance-tab-stakeholders', 'governance-tab-register', 'project-tab-tasks'] as const) {
    await page.getByTestId(id).click()
    await expect(page.getByTestId(id)).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مشروع ألفا')
  }
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)
  await expect(page.getByTestId('shell-main')).toHaveAttribute('data-test-animation-count', '0')
})
