import { expect, test, type Page } from '@playwright/test'

// A settings page is one page of cards: the sidebar sub-list scrolls to a card in place, follows the reader while
// scrolling, and a direct link with a hash lands on its card. Isolated mock stack (admin / admin).
async function login(page: Page) {
  // The context menu starts folded; these checks read the pinned menu.
  await page.context().addCookies([{ name: 'liwan-context-sidebar', value: 'open', url: new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').origin }])
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

// The page is interactive once hydrated: a click before that is lost.
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
const cardTop = (page: Page, id: string) => page.evaluate((target) => document.getElementById(target)?.getBoundingClientRect().top ?? Number.NaN, id)
const subListLink = (page: Page, id: string) => page.locator(`.liwan-sub-list a[href="/settings/company#${id}"]`)

test.describe('settings page of cards', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 })
    await login(page)
  })

  test('a sub-list click scrolls to its card in place and rewrites the hash, then a second click does the same', async ({ page }) => {
    await open(page, '/settings/company')
    await expect(page.locator('#address')).toBeVisible()
    await page.evaluate(() => { (window as unknown as { __sameDocument: boolean }).__sameDocument = true })
    const header = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.getElementById('address')!).scrollMarginTop))

    await subListLink(page, 'address').click()
    await expect.poll(() => new URL(page.url()).hash, { timeout: 15_000 }).toBe('#address')
    await expect.poll(async () => Math.abs((await cardTop(page, 'address')) - header), { timeout: 15_000 }).toBeLessThan(4)
    await expect(subListLink(page, 'address')).toHaveAttribute('aria-current', 'true')

    await subListLink(page, 'profile').click()
    await expect.poll(() => new URL(page.url()).hash, { timeout: 15_000 }).toBe('#profile')
    await expect.poll(async () => Math.abs((await cardTop(page, 'profile')) - header), { timeout: 15_000 }).toBeLessThan(4)
    await expect(subListLink(page, 'profile')).toHaveAttribute('aria-current', 'true')

    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true)
  })

  test('keyboard activation of a sub-list link (Tab, then Enter) scrolls to the card too', async ({ page }) => {
    await open(page, '/settings/company')
    await expect(page.locator('#address')).toBeVisible()
    const header = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.getElementById('address')!).scrollMarginTop))
    await subListLink(page, 'address').focus()
    await expect(subListLink(page, 'address')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => new URL(page.url()).hash, { timeout: 15_000 }).toBe('#address')
    await expect.poll(async () => Math.abs((await cardTop(page, 'address')) - header), { timeout: 15_000 }).toBeLessThan(4)
    await expect(subListLink(page, 'address')).toHaveAttribute('aria-current', 'true')
  })

  test('scrolling moves the active sub-list item and the hash to the card being read', async ({ page }) => {
    await open(page, '/settings/company')
    await expect(page.locator('#branding')).toBeVisible()
    await expect(subListLink(page, 'profile')).toHaveAttribute('aria-current', 'true')
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    // At the end of the page the last, short card is the one being read although it never reaches the reading band.
    await expect(subListLink(page, 'branding')).toHaveAttribute('aria-current', 'true', { timeout: 15_000 })
    await expect(subListLink(page, 'profile')).not.toHaveAttribute('aria-current', 'true')
    await expect.poll(() => new URL(page.url()).hash, { timeout: 15_000 }).toBe('#branding')
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await expect(subListLink(page, 'profile')).toHaveAttribute('aria-current', 'true', { timeout: 15_000 })
  })

  test('a direct link with a hash lands on its card', async ({ page }) => {
    await open(page, '/settings/company#branding')
    await expect(page.locator('#branding')).toBeVisible()
    await expect.poll(async () => {
      const top = await cardTop(page, 'branding')
      return top > 0 && top < 800
    }, { timeout: 15_000 }).toBe(true)
    await expect(subListLink(page, 'branding')).toHaveAttribute('aria-current', 'true')
  })

  for (const width of [1440, 375]) {
    test(`the team previews are compact rows that never scroll sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await open(page, '/settings/team')
      const rows = page.getByTestId('settings-preview-row')
      await expect(rows.first()).toBeVisible()
      expect(await page.locator('[data-slot="data-table"], table').count()).toBe(0)
      const overflow = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-testid$="-preview"]')]
        return { page: document.documentElement.scrollWidth > innerWidth, cards: cards.some(card => card.scrollWidth > card.clientWidth + 1) }
      })
      expect(overflow).toEqual({ page: false, cards: false })
    })
  }

  test('the team page previews its lists and links to the full ones', async ({ page }) => {
    await open(page, '/settings/team')
    await expect(page.getByTestId('team-users-preview')).toBeVisible()
    await page.getByTestId('team-users-preview').getByRole('link', { name: 'كل المستخدمين' }).click()
    await expect(page).toHaveURL(/\/settings\/team\/users$/)
    await expect(page.locator('.liwan-sub-list a[aria-current="true"]')).toHaveCount(1)
  })

  test.describe('projects settings', () => {
    const projectLink = (id: string) => (page: Page) => page.locator(`.liwan-sub-list a[href="/settings/apps/projects#${id}"]`)

    test('cold client navigation from the overview: the spy follows the cards that render after the data arrives', async ({ page }) => {
      await open(page, '/settings')
      // The sidebar entry opens its sub-list; the page itself is the sub-list's first link.
      await page.getByTestId('settings-projects-tab').click()
      await page.locator('.liwan-sub-list a[href="/settings/apps/projects"]').first().click()
      await expect(page).toHaveURL(/\/settings\/apps\/projects/)
      await expect(page.locator('#project-defaults')).toBeVisible({ timeout: 15_000 })
      await page.evaluate(() => window.scrollTo({ top: document.getElementById('project-defaults')!.getBoundingClientRect().top + scrollY - 80, behavior: 'instant' }))
      await expect(projectLink('project-defaults')(page)).toHaveAttribute('aria-current', 'true', { timeout: 15_000 })
    })

    test('a deep link with a hash after a cold navigation lands on its card', async ({ page }) => {
      await open(page, '/settings')
      await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push('/settings/apps/projects#project-defaults'))
      await expect(page.locator('#project-defaults')).toBeVisible({ timeout: 15_000 })
      await expect.poll(async () => Math.abs((await cardTop(page, 'project-defaults')) - 88), { timeout: 15_000 }).toBeLessThan(40)
      await expect(projectLink('project-defaults')(page)).toHaveAttribute('aria-current', 'true')
    })

    test('a round trip through the catalogs keeps the spy working', async ({ page }) => {
      await open(page, '/settings/apps/projects')
      await expect(page.locator('#catalogs')).toBeVisible({ timeout: 15_000 })
      await page.getByTestId('catalog-types-link').click()
      await expect(page).toHaveURL(/\/catalogs\/types/)
      await page.goBack()
      await expect(page.locator('#catalogs')).toBeVisible({ timeout: 15_000 })
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
      await expect(projectLink('catalogs')(page)).toHaveAttribute('aria-current', 'true', { timeout: 15_000 })
    })
  })

  test('on a 390px phone a sub-list tap in the drawer closes it and scrolls to the card', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, '/settings/company')
    await expect(page.locator('#address')).toBeVisible()
    await expect(page.getByTestId('mobile-navigation-trigger')).toBeEnabled()
    await page.getByTestId('mobile-navigation-trigger').click()
    const tap = page.locator('#mobile-navigation a[href="/settings/company#address"]')
    await expect(tap).toBeVisible()
    await tap.click()
    await expect(page.locator('#mobile-navigation')).toHaveCount(0)
    await expect.poll(() => new URL(page.url()).hash, { timeout: 15_000 }).toBe('#address')
    await expect.poll(async () => (await cardTop(page, 'address')) < 200, { timeout: 15_000 }).toBe(true)
  })
})
