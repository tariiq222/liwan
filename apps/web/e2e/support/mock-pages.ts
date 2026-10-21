import { expect, type Page } from '@playwright/test'

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

/**
 * The browser logs every refused request as a console error without its URL. This records the refused responses
 * (status 400 and up) whose URL contains `urlPart`; the returned function drops from a list of collected errors exactly
 * one "status of NNN" console error per such response, so any other error, or one more of the same status, still fails.
 */
export function trackRefusedRequests(page: Page, urlPart: string): (errors: string[]) => string[] {
  const statuses: number[] = []
  page.on('response', (response) => { if (response.status() >= 400 && response.url().includes(urlPart)) statuses.push(response.status()) })
  return (errors) => {
    const remaining = [...statuses]
    return errors.filter((message) => {
      const status = Number(/status of (\d{3})/.exec(message)?.[1])
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
  await page.goto(path)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(heading(page, title)).toBeVisible()
}
