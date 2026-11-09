import { expect, test, type Page } from '@playwright/test'
import { DESKTOP, login, open } from './support/tasmim6'

// The shell (sidebar, top bar, <main> and the frame around them) is never remounted by a client-side navigation: only the
// page inside <main> is swapped, with Nuxt's page transition. A property written on the DOM nodes and on `window` survives
// when the nodes are the same, and vanishes on a full reload or a remount. Run against the isolated mock stack.
test.setTimeout(90_000)
test.use({ viewport: DESKTOP })

const SHELL_NODES = {
  frame: '[data-liwan-shell]',
  main: '[data-testid="shell-main"]',
  sidebar: '[data-testid="application-navigation"]',
  header: '[data-testid="shell-header"]',
} as const

async function tag(page: Page) {
  await page.evaluate((selectors) => {
    for (const [name, selector] of Object.entries(selectors)) {
      const node = document.querySelector(selector) as (Element & { __persist?: string }) | null
      if (!node) throw new Error(`${name} (${selector}) is not on the page`)
      node.__persist = name
    }
    ;(window as unknown as { __marker?: string }).__marker = 'alive'
  }, SHELL_NODES)
}

async function expectSurvived(page: Page) {
  const survived = await page.evaluate((selectors) => {
    const result: Record<string, string | undefined> = { window: (window as unknown as { __marker?: string }).__marker }
    for (const [name, selector] of Object.entries(selectors)) result[name] = (document.querySelector(selector) as (Element & { __persist?: string }) | null)?.__persist
    return result
  }, SHELL_NODES)
  expect(survived).toEqual({ window: 'alive', frame: 'frame', main: 'main', sidebar: 'sidebar', header: 'header' })
}

test('the shell keeps its DOM nodes across home, an application, all applications and an application again', async ({ page }) => {
  await login(page)
  await open(page, '/')
  const menu = page.getByTestId('application-navigation')
  await expect(menu).toHaveAttribute('data-mode', 'global')
  await tag(page)

  // Home -> an application, through its sidebar row (CRM, or Projects where CRM is not pinned).
  const row = menu.locator('[data-testid="navigation-app-crm"], [data-testid="navigation-app-projects"]').first()
  await expect(row).toBeVisible()
  const target = await row.getAttribute('href')
  expect(target).toBeTruthy()
  await row.click()
  await expect(page).toHaveURL(new RegExp(`${target!.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`))
  await expect(menu).toHaveAttribute('data-mode', 'app')
  await expect(page.getByTestId('shell-main')).toBeVisible()
  await expectSurvived(page)

  // The application's back row «كل التطبيقات» -> /apps (the sidebar returns to the global mode in place).
  await menu.getByTestId('navigation-app-back').click()
  await expect(page).toHaveURL(/\/apps$/)
  await expect(menu).toHaveAttribute('data-mode', 'global')
  await expect(page.getByTestId('apps-page')).toBeVisible()
  await expectSurvived(page)

  // /apps -> an application card.
  const openButton = page.getByTestId('launcher-open').first()
  await expect(openButton).toBeVisible()
  await openButton.click()
  await expect(page).not.toHaveURL(/\/apps$/)
  await expect(page.getByTestId('shell-main')).toBeVisible()
  await expectSurvived(page)
})
