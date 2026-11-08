import { expect, test, type Page } from '@playwright/test'
import { login, open, fitsWidth, PHONE } from './support/tasmim6'

test.setTimeout(90_000)

// The top bar, start to end: search, the assistant, a divider, the work tools, a divider, the notifications and the
// user menu. One 40px icon-button style; the user menu holds the account, the dark switch, the language and sign out.
const restoreAppearance = (page: Page) => page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: 'small' } })

test.describe('top bar (desktop)', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => {
    await login(page)
    await open(page, '/projects')
  })

  test('groups the controls in order and separates them with two dividers', async ({ page }) => {
    const bar = page.getByTestId('shell-header')
    const order = await bar.evaluate(header => {
      const ids = ['global-search-trigger', 'assistant-button', 'meetings-tool', 'tasks-tool', 'chat-tool', 'notification-bell', 'account-menu']
      const dividers = [...header.querySelectorAll('.liwan-shell-divider')]
      const items = [...ids.map(id => ({ id, node: header.querySelector(`[data-testid="${id}"]`) })), ...dividers.map(node => ({ id: 'divider', node }))]
      // In reading order the inline start is the visually later x in RTL: sort by the document position instead of geometry.
      return items.filter(item => item.node).sort((a, b) => (a.node!.compareDocumentPosition(b.node!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).map(item => item.id)
    })
    expect(order).toEqual(['global-search-trigger', 'assistant-button', 'divider', 'meetings-tool', 'tasks-tool', 'chat-tool', 'divider', 'notification-bell', 'account-menu'])
    await expect(bar.getByTestId('app-switcher')).toHaveCount(0)
    await expect(bar.getByTestId('theme-toggle')).toHaveCount(0)
  })

  test('every icon button is 40px with no background at rest and fills on hover', async ({ page }) => {
    for (const id of ['meetings-tool', 'tasks-tool', 'chat-tool', 'notification-bell']) {
      const button = page.getByTestId(id)
      const box = (await button.boundingBox())!
      expect(box.width).toBeCloseTo(40, 0)
      expect(box.height).toBeCloseTo(40, 0)
      await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    }
    const bell = page.getByTestId('notification-bell')
    await bell.hover()
    await expect(bell).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  })

  test('the user button shows the name and role and opens the menu; Escape closes it and returns focus', async ({ page }) => {
    const trigger = page.getByTestId('account-menu')
    await expect(trigger).toBeEnabled()
    await expect(trigger.locator('[data-slot="name"]')).not.toBeEmpty()
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    await trigger.click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(menu.getByRole('menuitem', { name: 'حسابي' })).toHaveAttribute('href', '/account')
    await expect(menu.getByRole('menuitemcheckbox', { name: 'الوضع الداكن' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'English' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'تسجيل الخروج' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('my account opens the self-service page', async ({ page }) => {
    await page.getByTestId('account-menu').click()
    await page.getByRole('menuitem', { name: 'حسابي' }).click()
    await expect(page).toHaveURL(/\/account$/)
  })

  test('the dark switch flips the colour mode', async ({ page }) => {
    const html = page.locator('html')
    const dark = (await html.getAttribute('class'))?.includes('dark') ?? false
    try {
      await page.getByTestId('account-menu').click()
      const toggle = page.getByRole('menuitemcheckbox', { name: 'الوضع الداكن' })
      await expect(toggle).toHaveAttribute('aria-checked', String(dark))
      await toggle.click()
      if (dark) await expect(html).not.toHaveClass(/dark/)
      else await expect(html).toHaveClass(/dark/)
    } finally {
      await restoreAppearance(page)
    }
  })

  test('the language item switches the interface language and direction', async ({ page }) => {
    await page.getByTestId('account-menu').click()
    await page.getByRole('menuitem', { name: 'English' }).click()
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await page.getByTestId('account-menu').click()
    await page.getByRole('menuitem', { name: 'العربية' }).click()
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  })

  test('⌘K opens an application by typing its name and pressing Enter', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByTestId('command-palette')
    await expect(palette).toBeVisible()
    await palette.locator('#global-search-input').fill('الاجتماعات')
    await expect(palette.getByRole('option', { name: /الاجتماعات/ }).first()).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/meetings/)
    await expect(palette).toBeHidden()
  })
})

test.describe('top bar (phone)', () => {
  test.use({ viewport: PHONE })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('keeps the compact bar: mark, search, notifications and the user avatar opening the same menu', async ({ page }) => {
    await open(page, '/projects')
    const bar = page.getByTestId('shell-header')
    await expect(bar.getByTestId('global-search-trigger')).toBeVisible()
    await expect(bar.getByTestId('notification-bell')).toBeVisible()
    await expect(bar.getByTestId('meetings-tool')).toBeHidden()
    await expect(bar.locator('.liwan-shell-divider').first()).toBeHidden()
    const trigger = bar.getByTestId('account-menu')
    await expect(trigger.locator('[data-slot="copy"]')).toBeHidden()
    expect(await fitsWidth(page)).toBe(true)
    await trigger.click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'حسابي' })).toBeVisible()
    await expect(menu.getByRole('menuitemcheckbox', { name: 'الوضع الداكن' })).toBeVisible()
    await expect(page.getByTestId('shell-tabbar')).toBeVisible()
  })
})
