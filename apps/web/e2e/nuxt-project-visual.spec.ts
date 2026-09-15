import { test, expect } from '@playwright/test'

for (const [mode, fontSize, width] of [['light', 'small', 1440], ['dark', 'large', 768], ['cream', 'medium', 390]] as const) {
  test(`project surfaces render in ${mode}, ${fontSize}, ${width}px`, async ({ page, context, baseURL }, testInfo) => {
    test.setTimeout(120_000)
    if (!baseURL?.includes(':3469')) throw new Error('Isolated migration runtime required')
    expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).ok()).toBeTruthy()
    await context.addCookies([{ name: 'nasq-appearance', value: encodeURIComponent(JSON.stringify({ mode, fontSize })), url: baseURL }])
    await page.setViewportSize({ width, height: 960 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (/Failed to resolve component: U/.test(message.text())) errors.push(message.text()) })
    const created = await page.request.post('/api/v1/projects', { data: { name: `مراجعة الثيم ${mode} ${Date.now()}`, date_start: '2026-01-01', date_end: '2030-12-31' } })
    expect(created.status()).toBe(201)
    const project = await created.json()
    expect((await page.request.post(`/api/v1/projects/${project.id}/register`, { data: { kind: 'issue', title: 'متابعة توريد الأجهزة', priority: 'high' } })).status()).toBe(201)
    expect((await page.request.post(`/api/v1/projects/${project.id}/stakeholders`, { data: { name: 'فريق التشغيل', organization: 'إدارة المشاريع', role: 'متابعة التنفيذ' } })).status()).toBe(201)
    const routes = ['/projects', '/projects/dashboard', `/projects/${project.id}?tab=summary`, `/projects/${project.id}/register`, `/projects/${project.id}/stakeholders`, '/project-templates/new', `/projects/${project.id}/tasks/new`]
    for (const [index, route] of routes.entries()) {
      await page.goto(route)
      await expect(page.locator('html')).toHaveAttribute('data-font-size', fontSize)
      if (mode !== 'light') await expect(page.locator('html')).toHaveClass(new RegExp(mode))
      await expect(page.locator('main').first()).toBeVisible()
      await expect(page.getByTestId('mobile-navigation-trigger')).toBeEnabled()
      await page.evaluate(() => document.fonts.ready)
      if (mode === 'dark') {
        // Exercise the application's existing i18n runtime; no new language UI.
        await page.evaluate(async () => {
          const root = document.querySelector('#__nuxt') as Element & { __vue_app__?: { $nuxt?: { $i18n?: { setLocale: (code: string) => Promise<void> } } } }
          const nuxt = root?.__vue_app__?.$nuxt
          if (!nuxt?.$i18n) throw new Error('Nuxt i18n runtime unavailable')
          await nuxt.$i18n.setLocale('en')
        })
        await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
      } else await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
      expect(await page.locator('body').innerText()).not.toMatch(/500\s*Internal Server Error|Page not found/)
      if (route.endsWith('/register') || route.endsWith('/stakeholders')) {
        const label = route.endsWith('/register') ? 'متابعة توريد الأجهزة' : 'فريق التشغيل'
        await expect(page.getByRole('link', { name: label, exact: true }).filter({ visible: true })).toBeVisible()
        if (width < 768) await expect(page.locator('table')).not.toBeVisible()
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
      if (width < 768) {
        for (const control of await page.getByTestId('shell-header').getByRole('button').all()) {
          if (!await control.isVisible()) continue
          const box = await control.boundingBox()
          expect(box!.x).toBeGreaterThanOrEqual(0)
          expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        }
      }
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined)))
      })
      if ((route.endsWith('/tasks/new') || route.endsWith('/project-templates/new')) && width < 768) {
        const panel = page.getByRole('dialog')
        await expect(panel).toBeVisible()
        await expect.poll(async () => (await panel.boundingBox())?.width).toBeGreaterThan(width - 1)
      }
      await page.screenshot({ path: testInfo.outputPath(`${index}-${mode}-${width}.png`), fullPage: true })
    }
    expect(errors).toEqual([])
  })
}
