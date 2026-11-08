import { expect, test } from '@playwright/test'
import { expectAlignedGuide } from './helpers/navigationGeometry'

test.setTimeout(90_000)
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { login: process.env.E2E_ADMIN_LOGIN ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin' } })).status()).toBe(200)
  await page.goto('/tasks?view=board')
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
})

test('the application name is static and each branch folds on its own button without navigation', async ({ page }) => {
  const navigation = page.getByTestId('application-navigation')
  await expect(navigation.getByTestId('navigation-app-block')).toHaveText('المشاريع')
  await expect(navigation.locator('h2 button')).toHaveCount(0)
  const tasks = navigation.getByTestId('context-link-tasks')
  await expect(tasks).toHaveAttribute('aria-expanded', 'true')
  const originalUrl = page.url()
  await tasks.click()
  await expect(tasks).toHaveAttribute('aria-expanded', 'false')
  await expect(navigation.getByTestId('quick-view-today')).toHaveCount(0)
  await expect(navigation.getByTestId('context-link-project-dashboard')).toBeVisible()
  await expect(navigation.getByTestId('context-link-projects')).toBeVisible()
  await expect(navigation.getByTestId('quick-action-new-project')).toBeVisible()
  await expect(page).toHaveURL(originalUrl)
  await tasks.click()
  await expect(navigation.getByTestId('quick-view-today')).toBeVisible()
  // Branches are independent: opening the projects list leaves the tasks branch as it was.
  await navigation.getByTestId('context-link-projects').click()
  await expect(navigation.getByTestId('context-link-projects')).toHaveAttribute('aria-expanded', 'true')
  await expect(tasks).toHaveAttribute('aria-expanded', 'true')
  await expect(navigation.getByTestId('quick-view-mine')).toBeVisible()
  await expect(navigation.getByTestId('quick-view-today')).toBeVisible()
  await expect(page).toHaveURL(originalUrl)
  await navigation.getByTestId('quick-view-today').click()
  await expect(page).toHaveURL(/deadline=today/)
  await expect(page).toHaveURL(/view=board/)
})

test('the Tasks branch is keyboard operable and retains its unfiltered destination', async ({ page }) => {
  const navigation = page.getByTestId('application-navigation')
  const tasks = navigation.getByTestId('context-link-tasks')
  await tasks.press('Enter')
  await expect(tasks).toHaveAttribute('aria-expanded', 'false')
  await expect(navigation.getByTestId('submenu-tasks')).toHaveCount(0)
  await tasks.press('Space')
  await expect(tasks).toHaveAttribute('aria-expanded', 'true')
  await navigation.getByTestId('context-link-tasks-all').click()
  await expect(page).toHaveURL(/\/tasks\?view=board$/)
})

test('parent and child levels have distinct labels and visual hierarchy in RTL', async ({ page }) => {
  await page.goto('/projects')
  const menu = page.getByTestId('application-navigation')
  const parent = menu.getByTestId('context-link-projects')
  await expect(parent).toHaveAccessibleName('قائمة المشاريع')
  const children = menu.getByTestId('submenu-projects')
  await expect(children).toBeVisible()
  await expectAlignedGuide(parent)
  expect(await parent.getAttribute('data-active')).toBeNull()
  const all = children.getByRole('link', { name: 'عرض الكل', exact: true })
  await expect(all).toHaveAttribute('data-active', 'true')
  await expect(all).toHaveCSS('font-weight', '600')
})

test('English hierarchy mirrors the guide', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'liwan-locale', value: 'en', url: baseURL! }])
  await page.goto('/projects')
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  const menu = page.getByTestId('application-navigation')
  await expect(menu.getByTestId('context-link-projects')).toHaveAccessibleName('Projects list')
  await expectAlignedGuide(menu.getByTestId('context-link-projects'))
})

const responsiveCases = [
  { width: 360, fontSize: 'large', mode: 'dark' },
  { width: 390, fontSize: 'small', mode: 'light' },
  { width: 767, fontSize: 'medium', mode: 'dark' },
  { width: 768, fontSize: 'small', mode: 'light' },
  { width: 1024, fontSize: 'large', mode: 'dark' },
  { width: 1100, fontSize: 'medium', mode: 'light' },
  { width: 1440, fontSize: 'large', mode: 'dark' },
] as const

// Under 768px the branches live in the drawer; from 768px to 1099px the sidebar is an 84px icon column that shows no
// branches; from 1100px the full sidebar draws the guide.
for (const entry of responsiveCases) {
  test.describe(`submenu guide at ${entry.width}px`, () => {
    test.use({ viewport: { width: entry.width, height: 900 }, isMobile: entry.width < 768, hasTouch: entry.width < 768 })
    for (const locale of ['ar', 'en']) {
      test(`aligns and fits in ${locale}, ${entry.fontSize}, ${entry.mode}`, async ({ page, baseURL }) => {
        expect((await page.request.patch('/api/v1/me/appearance', { data: { mode: entry.mode, font_size: entry.fontSize } })).status()).toBe(200)
        try {
          await page.context().addCookies([{ name: 'liwan-locale', value: locale, url: baseURL! }])
          await page.goto('/projects?status=at_risk')
          await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })
          await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
          await expect(page.locator('html')).toHaveAttribute('data-font-size', entry.fontSize)
          await expect(page.locator('html')).toHaveCSS('color-scheme', entry.mode)
          let menu = page.getByTestId('application-navigation')
          let prefix = ''
          if (entry.width < 768) {
            await page.getByTestId('mobile-navigation-trigger').click()
            menu = page.locator('#mobile-navigation')
            prefix = 'mobile-'
          }
          const parent = menu.getByTestId(`${prefix}context-link-projects`)
          await expect(parent).toBeVisible()
          await expect(parent).toHaveAttribute('aria-expanded', 'true')
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
          if (entry.width >= 768 && entry.width < 1100) {
            expect((await menu.boundingBox())!.width).toBe(84)
            await expect(menu.getByTestId('submenu-projects')).toBeHidden()
            return
          }
          const child = menu.locator('.liwan-side-branch .liwan-side-row[data-active="true"]')
          await expect(child).toBeVisible()
          await expectAlignedGuide(parent)
          expect(await menu.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
          expect(await menu.locator('.liwan-side-branch [data-slot="label"]').evaluateAll(labels => labels.every(label => {
            const text = label.getBoundingClientRect()
            const row = label.closest('.liwan-side-row')!.getBoundingClientRect()
            return text.left >= row.left - 1 && text.right <= row.right + 1
          }))).toBe(true)
        } finally {
          await page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: 'small' } })
        }
      })
    }
  })
}
