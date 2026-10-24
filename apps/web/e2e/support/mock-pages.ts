import { expect, type Page } from '@playwright/test'
import { open as openHydrated } from './tasmim6'

// Shared by the mock-backed page specs of the HR areas and finance phase 3: what a page must not raise, and the
// locators and navigation both specs use. The session itself comes from `login` in ./tasmim6.
export const MOCK_STACK_ONLY = 'Isolated synthetic API only'

/** Uncaught page errors and console errors seen from now on; read the list at the end of a test. */
export function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
  return errors
}

// The exact line Chromium logs for a refused resource load, without the URL it belongs to.
const RESOURCE_REFUSAL = /^console: Failed to load resource: the server responded with a status of (4\d\d) /

/**
 * Records the refused responses (status 400-499) whose URL contains `urlPart`; the returned function drops, from a list
 * of collected errors, exactly one browser resource-refusal line of the same status per such response. Page errors,
 * application console errors, server errors (5xx) and any surplus refusal line stay in the list and fail the test.
 */
export function trackRefusedRequests(page: Page, urlPart: string): (errors: string[]) => string[] {
  const statuses: number[] = []
  page.on('response', (response) => {
    const status = response.status()
    if (status >= 400 && status < 500 && response.url().includes(urlPart)) statuses.push(status)
  })
  return (errors) => {
    const remaining = [...statuses]
    return errors.filter((message) => {
      const status = Number(RESOURCE_REFUSAL.exec(message)?.[1])
      const at = remaining.indexOf(status)
      if (at < 0) return true
      remaining.splice(at, 1)
      return false
    })
  }
}

/** The route the browser is on, without the origin: path plus query. */
export function currentRoute(page: Page): string {
  const url = new URL(page.url())
  return `${url.pathname}${url.search}`
}

export const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true })
export const row = (page: Page, name: string | RegExp) => page.getByRole('row', { name })
export const dialog = (page: Page) => page.getByRole('dialog')

/** Opens a page and checks it is right-to-left with its exact h1. */
export async function openPage(page: Page, path: string, title: string) {
  await openHydrated(page, path)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(heading(page, title)).toBeVisible()
}
