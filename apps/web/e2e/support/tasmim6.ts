import { expect, type Page } from '@playwright/test'

// Shared by every Plan 6 spec. The session comes from the login API; the mock lists the data of e2e/pmo-ui-preview-data.mjs.
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'

export const DESKTOP = { width: 1440, height: 900 } as const
export const PHONE = { width: 390, height: 844 } as const

export async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}

/** Navigates and waits for the shell to hydrate (the global search trigger is the shell's hydration signal). */
export async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}

export const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
export const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')
export const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

/** Inside the project workspace the frame's project name is the only top-level heading. */
export async function expectFrameOwnsH1(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByTestId('project-workspace-name')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(await page.getByTestId('project-workspace-name').innerText())
}

/**
 * Types into the search box and clicks a row link in one browser task, so the 250ms search debounce has
 * not written the query into the URL yet. Returns nothing; the caller asserts the opened URL's returnTo.
 */
export async function typeThenOpen(page: Page, opts: { search: string; link: string }) {
  await expect(page.locator('[data-shortcut-search] input')).toBeEnabled()
  await page.evaluate(({ search, link }) => {
    const input = document.querySelector<HTMLInputElement>('[data-shortcut-search] input')!
    input.value = search
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector<HTMLElement>(link)!.click()
  }, opts)
}
