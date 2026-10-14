import { test, expect } from '@playwright/test'
import { login, open } from './support/tasmim6'

const lists = [
  { name: 'documents', path: '/hr/documents', input: '[data-shortcut-search] input', search: 'دليل', record: '/hr/departments/1/documents/1', create: 'hr-document-new' },
  { name: 'meetings', path: '/meetings', input: '#meeting-search', search: 'اجتماع', record: '/meetings/1', create: 'meeting-new' },
  { name: 'series', path: '/meetings/series', input: '#meeting-series-search', search: 'اجتماعات', record: '/meetings/series/1', create: 'meeting-series-new' },
] as const

async function slowRefresh(page: Parameters<typeof open>[0]) {
  await page.route('**/api/v1/me', async route => {
    await new Promise(resolve => setTimeout(resolve, 400))
    await route.continue()
  })
}

for (const list of lists) {
  for (const activation of ['title', 'background', 'keyboard', 'mobile-title'] as const) {
    test(`${list.name} ${activation} departure retains live search under slow auth`, async ({ page }) => {
      if (activation === 'mobile-title') await page.setViewportSize({ width: 390, height: 844 })
      await login(page)
      await open(page, `${list.path}#list`)
      const rowSelector = activation === 'mobile-title' ? 'li[data-shortcut-row]' : 'tbody tr[data-shortcut-row]'
      await expect(page.locator(rowSelector).first()).toBeVisible()
      await slowRefresh(page)
      await page.evaluate(({ input, search, rowSelector, activation }) => {
        const field = document.querySelector<HTMLInputElement>(input)!
        field.value = search
        field.dispatchEvent(new Event('input', { bubbles: true }))
        const row = document.querySelector<HTMLElement>(rowSelector)!
        if (activation === 'title' || activation === 'mobile-title') row.querySelector<HTMLElement>('a')!.click()
        else if (activation === 'background') row.querySelector<HTMLElement>('td')!.click()
        else {
          row.focus()
          row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        }
      }, { ...list, rowSelector, activation })
      await expect.poll(() => new URL(page.url()).pathname).toBe(list.record)
      const origin = new URL(new URL(page.url()).searchParams.get('returnTo')!, page.url())
      expect(origin.pathname).toBe(list.path)
      expect(origin.searchParams.get('q')).toBe(list.search)
      expect(origin.hash).toBe('#list')
      await page.getByRole('link', { name: 'رجوع', exact: true }).first().click()
      await expect.poll(() => new URL(page.url()).pathname).toBe(list.path)
      expect(new URL(page.url()).searchParams.get('q')).toBe(list.search)
      expect(new URL(page.url()).hash).toBe('#list')
    })
  }
  test(`${list.name} create departure retains live search before render`, async ({ page }) => {
    await login(page)
    await open(page, `${list.path}#list`)
    await expect(page.getByTestId(list.create)).toBeVisible()
    await slowRefresh(page)
    await page.evaluate(({ input, search, create }) => {
      const field = document.querySelector<HTMLInputElement>(input)!
      field.value = search
      field.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector<HTMLElement>(`[data-testid="${create}"]`)!.click()
    }, list)
    await expect.poll(() => new URL(page.url()).pathname).toBe(`${list.path}/new`)
    const target = new URL(page.url())
    const origin = list.name === 'documents' ? target : new URL(target.searchParams.get('returnTo')!, target)
    expect(origin.searchParams.get('q')).toBe(list.search)
    await expect(page.getByRole('dialog')).toBeVisible()
  })
  test(`${list.name} debounced search retains its fragment`, async ({ page }) => {
    await login(page)
    await open(page, `${list.path}#list`)
    await page.locator(list.input).fill(list.search)
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(list.search)
    expect(new URL(page.url()).hash).toBe('#list')
  })
}

test('dashboard title departure survives slow auth without copying search to the record', async ({ page }) => {
  await login(page)
  await open(page, '/projects/dashboard#dashboard')
  await expect(page.locator('#project-dashboard-recent tbody a').first()).toBeVisible()
  await slowRefresh(page)
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="project-dashboard-page"] input')!
    input.value = 'تطوير'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector<HTMLElement>('#project-dashboard-recent tbody a')!.click()
  })
  await expect.poll(() => /^\/projects\/\d+(?:\/.*)?$/.test(new URL(page.url()).pathname)).toBe(true)
  expect(new URL(page.url()).searchParams.has('q')).toBe(false)
})

test('dashboard debounced search retains its fragment', async ({ page }) => {
  await login(page)
  await open(page, '/projects/dashboard#dashboard')
  await page.locator('[data-testid="project-dashboard-page"] input').fill('تطوير')
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('تطوير')
  expect(new URL(page.url()).hash).toBe('#dashboard')
})
