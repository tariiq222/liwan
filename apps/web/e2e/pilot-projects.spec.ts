import { expect, test, type Page } from '@playwright/test'

// Plan 5 pilot: /projects on SharedListPage + SharedDataTable. Runs on the isolated mock stack
// (Nuxt + mock API, see p5-e2e.sh); the session comes from the login API. The mock lists three projects.
const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin'
async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { login: ADMIN_LOGIN, password: ADMIN_PASSWORD } })
  expect(response.status()).toBe(200)
}
async function open(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
}
const rows = (page: Page) => page.locator('tbody tr[data-shortcut-row]')
const mobileRows = (page: Page) => page.locator('li[data-shortcut-row]')
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('Plan 5 pilot: the projects list', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('the table view is the list template: one heading, the page create button, a data table', async ({ page }) => {
      await open(page, '/projects?view=table')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('المشاريع')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.locator('[data-slot="data-table"]')).toBeVisible()
      await expect(rows(page)).toHaveCount(3)
      const create = page.getByTestId('project-new')
      await expect(create).toBeVisible()
      await expect(create).toHaveAttribute('data-shortcut-create', '')
      await expect(page.getByTestId('projects-toolbar')).toBeVisible()
      await expect(page.getByTestId('projects-result-count')).toContainText('3')
      await expect(page.getByTestId('project-templates-link')).toBeVisible()
      await expect(page.getByTestId('projects-view-table')).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('project-row').first()).toHaveAttribute('href', /\/projects\/\d+\?.*returnTo=/)
      await expect(rows(page).first().getByTestId('project-progress')).toBeVisible()
    })

    test('an unknown or explicit ?view= opens a list view and a switch keeps the other filters', async ({ page }) => {
      await open(page, '/projects')
      await expect(page.getByTestId('project-card')).toHaveCount(3)
      await expect(page.getByTestId('projects-view-cards')).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('[data-slot="data-table"]')).toHaveCount(0)
      await open(page, '/projects?view=gantt')
      await expect(page.getByTestId('project-card')).toHaveCount(3)
      await open(page, '/projects?view=cards')
      await expect(page.getByTestId('project-card')).toHaveCount(3)
      await open(page, '/projects?status=on_track&view=table')
      await expect(rows(page)).toHaveCount(3)
      await page.getByTestId('projects-view-cards').click()
      await expect(page.getByTestId('project-card')).toHaveCount(3)
      expect(new URL(page.url()).searchParams.get('status')).toBe('on_track')
      expect(new URL(page.url()).searchParams.has('view')).toBe(false)
      await page.getByTestId('projects-view-table').click()
      await expect(rows(page)).toHaveCount(3)
      expect(new URL(page.url()).searchParams.get('view')).toBe('table')
      expect(new URL(page.url()).searchParams.get('status')).toBe('on_track')
    })

    test('J and K move between rows and Enter opens the focused project', async ({ page }) => {
      await open(page, '/projects?view=table')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await expect(rows(page).nth(1)).toBeFocused()
      await page.keyboard.press('k')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/projects\/1(?:\?|$)/)
    })

    test('/ focuses the search and C presses the page create button, keeping the view in the return path', async ({ page }) => {
      await open(page, '/projects?view=table')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('/')
      await expect(page.locator('[data-shortcut-search] input')).toBeFocused()
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/projects\/new\?/)
      expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/projects?view=table')
    })

    test('a search typed inside the debounce drops the offset from the return path', async ({ page }) => {
      await open(page, '/projects?view=table&offset=20')
      await expect(page.locator('[data-shortcut-search] input')).toBeEnabled()
      await page.evaluate(async () => {
        const input = document.querySelector<HTMLInputElement>('[data-shortcut-search] input')!
        input.value = 'ألفا'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        // Let Vue re-render the create link (well inside the 250ms debounce), then open it.
        await new Promise(resolve => setTimeout(resolve, 30))
        document.querySelector<HTMLElement>('a[data-testid="project-new"]')!.click()
      })
      await expect(page).toHaveURL(/\/projects\/new\?/)
      const back = new URL(new URL(page.url()).searchParams.get('returnTo')!, 'http://x')
      expect(back.searchParams.get('q')).toBe('ألفا')
      expect(back.searchParams.has('offset')).toBe(false)
    })

    test('switching the view inside the debounce keeps the typed search', async ({ page }) => {
      await open(page, '/projects?view=table')
      await expect(page.locator('[data-shortcut-search] input')).toBeEnabled()
      await page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>('[data-shortcut-search] input')!
        input.value = 'ألفا'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector<HTMLElement>('[data-testid="projects-view-cards"]')!.click()
      })
      await expect(page.getByTestId('project-card').first()).toBeVisible()
      await expect(page.locator('[data-shortcut-search] input')).toHaveValue('ألفا')
    })

    for (const target of ['row background', 'name link'] as const) {
      test(`a row opened right after typing keeps the search in its return path (${target})`, async ({ page }) => {
        await open(page, '/projects?view=table')
        await expect(page.locator('[data-shortcut-search] input')).toBeEnabled()
        // Type and open in one task, so the 250ms search debounce has not landed in the URL yet.
        await page.evaluate((how) => {
          const input = document.querySelector<HTMLInputElement>('[data-shortcut-search] input')!
          input.value = 'ألفا'
          input.dispatchEvent(new Event('input', { bubbles: true }))
          const row = document.querySelectorAll<HTMLElement>('tbody tr[data-shortcut-row]')[0]!
          if (how === 'name link') row.querySelector<HTMLElement>('[data-testid="project-row"]')!.click()
          else row.querySelectorAll<HTMLElement>('td')[2]!.click()
        }, target)
        await expect(page).toHaveURL(/\/projects\/\d+/)
        expect(new URL(page.url()).searchParams.get('returnTo') ?? '').toContain('q=')
      })
    }

    for (const target of ['row background', 'name link'] as const) {
      test(`a delayed project open commits the typed search and resets its return offset (${target})`, async ({ page }) => {
        await open(page, '/projects?view=table&offset=20')
        await expect(rows(page)).toHaveCount(3)
        await expect(page.locator('[data-shortcut-search] input')).toBeEnabled()
        // Delay only record navigation, beyond the search debounce. The list
        // commit must finish first, so it cannot cancel the pending record open.
        await page.evaluate(() => {
          const router = (window as any).useNuxtApp().$router
          router.beforeEach(async (to: { path: string }) => {
            if (/^\/projects\/\d+/.test(to.path)) await new Promise(resolve => setTimeout(resolve, 400))
          })
        })
        await page.evaluate(async how => {
          const input = document.querySelector<HTMLInputElement>('[data-shortcut-search] input')!
          input.value = 'ألفا'
          input.dispatchEvent(new Event('input', { bubbles: true }))
          const row = document.querySelector<HTMLElement>('tbody tr[data-shortcut-row]')!
          if (how === 'name link') await new Promise(resolve => requestAnimationFrame(resolve))
          if (how === 'name link') row.querySelector<HTMLElement>('[data-testid="project-row"]')!.click()
          else row.querySelectorAll<HTMLElement>('td')[2]!.click()
        }, target)
        await expect(page).toHaveURL(/\/projects\/1(?:\?|$)/)
        const back = new URL(new URL(page.url()).searchParams.get('returnTo')!, 'http://x')
        expect(back.pathname).toBe('/projects')
        expect(back.searchParams.get('q')).toBe('ألفا')
        expect(back.searchParams.has('offset')).toBe(false)
        expect(back.searchParams.get('view')).toBe('table')
      })
    }

    test('an older cancelled row open does not resume list writes during a newer open to the same URL', async ({ page }) => {
      await open(page, '/projects?view=table&offset=20')
      await expect(rows(page)).toHaveCount(3)
      await page.evaluate(() => {
        ;(window as any).__rowOpenAttempts = 0
        ;(window as any).useNuxtApp().$router.beforeEach(async (to: { path: string }) => {
          if (/^\/projects\/\d+/.test(to.path)) {
            ;(window as any).__rowOpenAttempts += 1
            await new Promise(resolve => setTimeout(resolve, 400))
          }
        })
      })
      await page.evaluate(async () => {
        const input = document.querySelector<HTMLInputElement>('[data-shortcut-search] input')!
        input.value = 'ألفا'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(resolve => requestAnimationFrame(resolve))
        const browser = window as any
        browser.__sameRecordTarget = document.querySelector<HTMLAnchorElement>('[data-testid="project-row"]')!.getAttribute('href')!
        void browser.useNuxtApp().$router.push(browser.__sameRecordTarget)
      })
      await page.waitForFunction(() => (window as any).__rowOpenAttempts === 1)
      // Exercise two real public-router attempts to the same fullPath, without
      // conflating a DOM row replacement or selection guard with cancellation.
      await page.evaluate(() => { void (window as any).useNuxtApp().$router.push((window as any).__sameRecordTarget) })
      await expect.poll(() => page.evaluate(() => (window as any).__rowOpenAttempts)).toBe(2)
      await expect(page).toHaveURL(/\/projects\/1(?:\?|$)/)
      const back = new URL(new URL(page.url()).searchParams.get('returnTo')!, 'http://x')
      expect(back.searchParams.get('q')).toBe('ألفا')
      expect(back.searchParams.has('offset')).toBe(false)
    })

    test('a delayed create open keeps the typed search and resets its return offset', async ({ page }) => {
      await open(page, '/projects?view=table&offset=20')
      await expect(page.locator('[data-shortcut-search] input')).toBeEnabled()
      await page.evaluate(() => {
        ;(window as any).useNuxtApp().$router.beforeEach(async (to: { path: string }) => {
          if (to.path === '/projects/new') await new Promise(resolve => setTimeout(resolve, 400))
        })
      })
      await page.evaluate(async () => {
        const input = document.querySelector<HTMLInputElement>('[data-shortcut-search] input')!
        input.value = 'ألفا'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(resolve => requestAnimationFrame(resolve))
        document.querySelector<HTMLElement>('a[data-testid="project-new"]')!.click()
      })
      await expect(page).toHaveURL(/\/projects\/new\?/)
      const back = new URL(new URL(page.url()).searchParams.get('returnTo')!, 'http://x')
      expect(back.searchParams.get('q')).toBe('ألفا')
      expect(back.searchParams.has('offset')).toBe(false)
      expect(back.searchParams.get('view')).toBe('table')
    })

    for (const outcome of ['blocked', 'superseded'] as const) {
      test(`list query writes resume after an outgoing create navigation is ${outcome}`, async ({ page }) => {
        await open(page, '/projects?view=table&offset=20')
        await expect(page.locator('[data-shortcut-search] input')).toBeEnabled()
        await page.evaluate(how => {
          const browser = window as any
          browser.__createAttempted = false
          browser.__createFailed = false
          const router = browser.useNuxtApp().$router
          router.beforeEach(async (to: { path: string }) => {
            if (to.path !== '/projects/new') return
            browser.__createAttempted = true
            await new Promise(resolve => setTimeout(resolve, 400))
            if (how === 'blocked') return false
          })
          router.afterEach((to: { path: string }, _from: unknown, failure: unknown) => {
            if (to.path === '/projects/new' && failure) browser.__createFailed = true
          })
        }, outcome)
        await page.evaluate(async () => {
          const input = document.querySelector<HTMLInputElement>('[data-shortcut-search] input')!
          input.value = 'ألفا'
          input.dispatchEvent(new Event('input', { bubbles: true }))
          await new Promise(resolve => requestAnimationFrame(resolve))
          document.querySelector<HTMLElement>('a[data-testid="project-new"]')!.click()
        })
        await page.waitForFunction(() => (window as any).__createAttempted)
        if (outcome === 'superseded') {
          await page.evaluate(() => (window as any).useNuxtApp().$router.replace('/projects?view=table&status=on_track'))
        }
        await page.waitForFunction(() => (window as any).__createFailed)
        if (outcome === 'blocked') {
          await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('ألفا')
          expect(new URL(page.url()).searchParams.has('offset')).toBe(false)
        }
        await page.locator('[data-shortcut-search] input').fill('بيتا')
        await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('بيتا')
        expect(new URL(page.url()).pathname).toBe('/projects')
        expect(new URL(page.url()).searchParams.get('view')).toBe('table')
      })
    }

    test('a throwing navigation guard releases paused list writes and keeps its rejection observable', async ({ page }) => {
      await open(page, '/projects?view=table&offset=20')
      await expect(page.locator('[data-shortcut-search] input')).toBeEnabled()
      await page.evaluate(() => {
        const browser = window as any
        browser.__navigationRejection = null
        browser.useNuxtApp().$router.beforeEach(async (to: { path: string }) => {
          if (to.path !== '/projects/new') return
          await new Promise(resolve => setTimeout(resolve, 400))
          throw new Error('intentional navigation rejection')
        })
      })
      await page.evaluate(async () => {
        const input = document.querySelector<HTMLInputElement>('[data-shortcut-search] input')!
        input.value = 'ألفا'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(resolve => requestAnimationFrame(resolve))
        const browser = window as any
        const target = document.querySelector<HTMLAnchorElement>('a[data-testid="project-new"]')!.getAttribute('href')!
        void browser.useNuxtApp().$router.push(target).catch((error: Error) => { browser.__navigationRejection = error.message })
      })
      await page.waitForFunction(() => (window as any).__navigationRejection !== null)
      expect(await page.evaluate(() => (window as any).__navigationRejection)).toBe('intentional navigation rejection')
      await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('ألفا')
      await page.locator('[data-shortcut-search] input').fill('بيتا')
      await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('بيتا')
      expect(new URL(page.url()).pathname).toBe('/projects')
      expect(new URL(page.url()).searchParams.has('offset')).toBe(false)
    })

    test('an obsolete throwing attempt to the same URL cannot resume writes during the current departure', async ({ page }) => {
      await open(page, '/projects?view=table&offset=20')
      await expect(rows(page)).toHaveCount(3)
      await page.evaluate(() => {
        const browser = window as any
        browser.__throwingAttempts = 0
        browser.__obsoleteRejection = null
        browser.useNuxtApp().$router.beforeEach(async (to: { path: string }) => {
          if (!/^\/projects\/\d+/.test(to.path)) return
          const attempt = ++browser.__throwingAttempts
          await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 300 : 600))
          if (attempt === 1) throw new Error('obsolete navigation rejection')
        })
      })
      await page.evaluate(async () => {
        const input = document.querySelector<HTMLInputElement>('[data-shortcut-search] input')!
        input.value = 'ألفا'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(resolve => requestAnimationFrame(resolve))
        const browser = window as any
        browser.__sameThrowingTarget = document.querySelector<HTMLAnchorElement>('[data-testid="project-row"]')!.getAttribute('href')!
        void browser.useNuxtApp().$router.push(browser.__sameThrowingTarget).catch((error: Error) => { browser.__obsoleteRejection = error.message })
      })
      await page.waitForFunction(() => (window as any).__throwingAttempts === 1)
      await page.evaluate(() => { void (window as any).useNuxtApp().$router.push((window as any).__sameThrowingTarget) })
      await page.waitForFunction(() => (window as any).__obsoleteRejection !== null)
      expect(await page.evaluate(() => (window as any).__obsoleteRejection)).toBe('obsolete navigation rejection')
      await expect(page).toHaveURL(/\/projects\/1(?:\?|$)/)
      expect(new URL(new URL(page.url()).searchParams.get('returnTo')!, 'http://x').searchParams.get('q')).toBe('ألفا')
    })

    test('modified row clicks, controls and selected text do not open a project', async ({ page }) => {
      await open(page, '/projects?view=table')
      await expect(rows(page)).toHaveCount(3)
      await page.evaluate(() => {
        ;(window as any).__projectRecordAttempts = []
        ;(window as any).useNuxtApp().$router.beforeEach((to: { path: string }) => {
          if (/^\/projects\/\d+/.test(to.path)) (window as any).__projectRecordAttempts.push(to.path)
        })
      })
      const background = rows(page).first().locator('td').nth(2)
      await background.click({ modifiers: ['Control'] })
      await background.click({ modifiers: ['Meta'] })
      await rows(page).first().getByTestId('project-menu').click()
      await page.keyboard.press('Escape')
      await page.evaluate(async () => {
        const row = document.querySelector<HTMLElement>('tbody tr[data-shortcut-row]')!
        const range = document.createRange()
        range.selectNodeContents(row.querySelector('[data-testid="project-row"]')!)
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
        row.querySelectorAll<HTMLElement>('td')[2]!.click()
        await new Promise(resolve => requestAnimationFrame(resolve))
      })
      expect(await page.evaluate(() => (window as any).__projectRecordAttempts)).toEqual([])
      await expect(page).toHaveURL(/\/projects\?view=table$/)
    })

    test('a modified project name link opens its real destination in another tab', async ({ page, context }) => {
      await open(page, '/projects?view=table')
      const [popup] = await Promise.all([
        // Native modified clicks open a context page without a window.opener.
        context.waitForEvent('page'),
        page.getByTestId('project-row').first().click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] }),
      ])
      try {
        await expect(popup).toHaveURL(/\/projects\/1(?:\?|$)/)
        expect(new URL(popup.url()).searchParams.get('returnTo')).toBe('/projects?view=table')
        await expect(page).toHaveURL(/\/projects\?view=table$/)
      } finally {
        await popup.close()
      }
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('on a 390px phone the mobile rows carry the same information and J skips the hidden table', async ({ page }) => {
      await open(page, '/projects?view=table')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(page.locator('table')).toBeHidden()
      const first = mobileRows(page).first()
      await expect(first).toContainText('مشروع ألفا')
      await expect(first.getByTestId('project-status')).toBeVisible()
      await expect(first.getByText('40%')).toBeVisible()
      await expect(first.getByText('Admin')).toBeVisible()
      await expect(first.getByTestId('project-menu')).toBeVisible()
      await expect(page.getByTestId('projects-view-table')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(1)).toBeFocused()
      await mobileRows(page).nth(0).click({ position: { x: 4, y: 4 } })
      await expect(page).toHaveURL(/\/projects\/1(?:\?|$)/)
    })

    test('the cards view fits the phone width', async ({ page }) => {
      await open(page, '/projects')
      await expect(page.getByTestId('project-card')).toHaveCount(3)
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
