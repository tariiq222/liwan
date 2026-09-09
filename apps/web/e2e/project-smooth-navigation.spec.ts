import { test, expect } from '@playwright/test'
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Isolated project mock only')
test('project sidebar changes content without replaying the whole page entrance', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
  await page.goto('/projects/1?tab=tasks')
  await expect(page.getByTestId('context-link-stakeholders')).toBeVisible()
  const origin = await page.evaluate(() => performance.timeOrigin)
  await page.evaluate(() => {
    const main = document.querySelector('[data-testid="shell-main"]')!
    main.setAttribute('data-test-animation-count', '0')
    main.addEventListener('animationstart', e => {
      if (e.target === main) main.setAttribute('data-test-animation-count', String(Number(main.getAttribute('data-test-animation-count')) + 1))
    })
  })
  for (const [id, heading] of [['stakeholders', 'أصحاب المصلحة'], ['risks', 'المخاطر والمشكلات'], ['tasks', 'المهام']] as const) {
    await page.getByTestId(`context-link-${id}`).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading)
  }
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)
  await expect(page.getByTestId('shell-main')).toHaveAttribute('data-test-animation-count', '0')
})
