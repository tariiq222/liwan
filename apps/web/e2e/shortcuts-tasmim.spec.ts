import { expect, test, type Page } from '@playwright/test'

// Runs against the isolated mock stack (Nuxt 4097 + mock API 4498); the session comes from the login API.
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function beforeHydration(page: Page, path: string) {
  let resume!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve })
  await page.route('**/_nuxt/**', async route => {
    if (route.request().resourceType() === 'script') await gate
    await route.continue()
  })
  await page.goto(path, { waitUntil: 'commit' })
  return resume
}
async function hydrated(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
/** A keydown as an Arabic (101) layout sends it: the Arabic character with the US physical code. */
async function arabicKey(page: Page, key: string, code: string) {
  await page.evaluate(([k, c]) => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: c, bubbles: true, cancelable: true }))
  }, [key, code] as const)
}
const dialog = (page: Page) => page.getByRole('dialog', { name: 'بحث', exact: true })

test.describe('Tasmim palette and shortcuts', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('the palette trigger and Cmd+K wait for hydration', async ({ page }) => {
    const resume = await beforeHydration(page, '/tasks')
    const trigger = page.getByTestId('global-search-trigger')
    await expect(trigger).toBeDisabled()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(dialog(page)).toHaveCount(0)
    resume()
    await expect(trigger).toBeEnabled()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(dialog(page)).toBeVisible()
  })

  test('Enter on a Go to option navigates and focus lands on the page', async ({ page }) => {
    await hydrated(page, '/tasks')
    await page.keyboard.press('ControlOrMeta+k')
    await dialog(page).getByRole('textbox').fill('المشاريع')
    await expect(dialog(page).getByRole('option', { name: 'المشاريع', exact: true })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/projects$/)
    await expect(dialog(page)).toBeHidden()
    await expect(page.getByTestId('shell-main')).toBeFocused()
  })

  test('an action opens its create form with a return path', async ({ page }) => {
    await hydrated(page, '/tasks')
    await page.keyboard.press('ControlOrMeta+k')
    await dialog(page).getByRole('option', { name: 'مشروع جديد', exact: true }).click()
    await expect(page).toHaveURL(/\/projects\/new\?returnTo=(?:%2F|\/)tasks$/)
  })

  test('G then P navigates by label and on an Arabic layout, never while typing', async ({ page }) => {
    await hydrated(page, '/tasks')
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('g')
    await page.keyboard.press('p')
    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
    await arabicKey(page, 'ل', 'KeyG')
    await arabicKey(page, 'ف', 'KeyT')
    await expect(page).toHaveURL(/\/tasks$/)
    await hydrated(page, '/projects')
    const search = page.locator('[data-shortcut-search] input')
    await expect(search).toBeEnabled()
    await search.click()
    await page.keyboard.type('gp')
    await expect(search).toHaveValue('gp')
    await page.waitForTimeout(300)
    await expect(page).toHaveURL(/\/projects(?:\?.*)?$/)
  })

  test('/ focuses the list search without typing a slash; C follows the sidebar create link', async ({ page }) => {
    await hydrated(page, '/projects')
    const search = page.locator('[data-shortcut-search] input')
    await expect(search).toBeEnabled()
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('/')
    await expect(search).toBeFocused()
    await expect(search).toHaveValue('')
    await page.getByRole('heading', { level: 1 }).click()
    // /projects has its own create button (data-shortcut-create); C presses it before any sidebar link.
    await expect(page.getByTestId('project-new')).toBeEnabled()
    await page.keyboard.press('c')
    await expect(page).toHaveURL(/\/projects\/new\?returnTo=(?:%2F|\/)projects$/)
    await hydrated(page, '/tasks')
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('c')
    await expect(page).toHaveURL(/\/tasks\/new\?returnTo=(?:%2F|\/)tasks$/)
  })

  test('? opens the shortcut help, and no plain shortcut fires while a popover is open', async ({ page }) => {
    await hydrated(page, '/tasks')
    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('Shift+Slash')
    await expect(page.getByTestId('command-palette')).toHaveAttribute('data-view', 'shortcuts')
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await page.getByTestId('notification-bell').click()
    await expect(page.locator('[data-dismissable-layer]')).not.toHaveCount(0)
    // Record whether the page saw g unprevented: the shell must leave a plain key alone while a popover is open.
    await page.evaluate(() => {
      (window as unknown as { __gPrevented: boolean[] }).__gPrevented = []
      window.addEventListener('keydown', event => {
        if (event.key === 'g') (window as unknown as { __gPrevented: boolean[] }).__gPrevented.push(event.defaultPrevented)
      })
    })
    await page.keyboard.press('g')
    await page.keyboard.press('p')
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => (window as unknown as { __gPrevented: boolean[] }).__gPrevented)).toEqual([false])
    await expect(page.locator('[data-dismissable-layer]')).not.toHaveCount(0)
    await expect(page).toHaveURL(/\/tasks$/)
  })

  test('Cmd+K does not open the palette over an open popover', async ({ page }) => {
    await hydrated(page, '/tasks')
    await page.getByTestId('notification-bell').click()
    await expect(page.getByTestId('notification-preview')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    // The notification popover is itself a dialog; the palette must not open over it.
    await expect(page.getByTestId('command-palette')).toHaveCount(0)
    await expect(page.getByTestId('notification-preview')).toBeVisible()
  })
  test('a palette navigation the draft guard blocks returns focus to the palette trigger', async ({ page }) => {
    // The branding form is a full page with the draft guard; a create panel would itself block Cmd+K.
    await hydrated(page, '/settings/company#branding')
    const color = page.getByTestId('branding-color')
    const saved = await color.inputValue()
    const draft = saved === '#abcdef' ? '#123456' : '#abcdef'
    await color.fill(draft)
    await page.keyboard.press('ControlOrMeta+k')
    await dialog(page).getByRole('textbox').fill('المشاريع')
    await expect(dialog(page).getByRole('option', { name: 'المشاريع', exact: true })).toBeVisible()
    await page.keyboard.press('Enter')
    const guard = page.getByTestId('unsaved-changes-dialog')
    await expect(guard).toBeVisible()
    await expect(dialog(page)).toBeHidden()
    await guard.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
    await expect(guard).toBeHidden()
    await expect(page).toHaveURL(/\/settings\/company#branding$/)
    await expect(page.getByTestId('global-search-trigger')).toBeFocused()
    await expect(color).toHaveValue(draft)
  })
})
