import { test, expect } from '@playwright/test'
import { login, open, typeThenOpen, rows } from './support/tasmim6'

// An auth refresh slower than the search debounce must not cancel the user's navigation.
for (const activation of ['title', 'background', 'keyboard'] as const) {
  test(`finance ${activation} navigation keeps a typed search while identity refresh is slow`, async ({ page }) => {
    await login(page)
    await open(page, '/projects/2/finance#ledger')
    await expect(rows(page)).toHaveCount(4)
    let refreshes = 0
    await page.route('**/api/v1/me', async route => {
      refreshes++
      await new Promise(resolve => setTimeout(resolve, 400))
      await route.continue()
    })
    if (activation === 'title') {
      await typeThenOpen(page, { search: 'ميزانية', link: '[data-testid="finance-entry-row"] a' })
    } else {
      await page.evaluate(mode => {
        const input = document.querySelector<HTMLInputElement>('[data-shortcut-search] input')!
        input.value = 'ميزانية'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        const row = document.querySelector<HTMLElement>('tbody tr[data-shortcut-row]')!
        if (mode === 'background') row.querySelector<HTMLElement>('td')!.click()
        else {
          row.focus()
          row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        }
      }, activation)
    }
    await expect(page).toHaveURL(/\/projects\/2\/finance\/51\?/)
    expect(refreshes).toBeGreaterThan(0)
    const origin = new URL(new URL(page.url()).searchParams.get('returnTo')!, page.url())
    expect(origin.searchParams.get('q')).toBe('ميزانية')
    expect(origin.hash).toBe('#ledger')
    await page.getByRole('link', { name: 'العودة إلى المالية', exact: true }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/projects/2/finance')
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('ميزانية')
    expect(new URL(page.url()).hash).toBe('#ledger')
  })
}

test('finance search retains the fragment during an ordinary debounced URL update', async ({ page }) => {
  await login(page)
  await open(page, '/projects/2/finance#ledger')
  await page.getByTestId('finance-search').fill('ميزانية')
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('ميزانية')
  expect(new URL(page.url()).hash).toBe('#ledger')
})
