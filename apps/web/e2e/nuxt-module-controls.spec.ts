import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
const ids = JSON.parse(readFileSync(process.env.E2E_ALL_UI_FIXTURES ?? '/Users/tariq/code/nasq-nuxt-migration-artifacts/all-ui/fixtures.json', 'utf8'))

test.beforeEach(async ({ page, baseURL }) => {
  expect(baseURL).toBe('http://127.0.0.1:3469')
  expect((await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin' } })).ok()).toBeTruthy()
})

test('HR shared selectors and form save retain the actual department data', async ({ page }, info) => {
  await page.goto(`/hr/departments/${ids.departmentId}/edit`)
  const sheet = page.locator('.nasq-ui-route-sheet')
  const name = `إدارة موحدة ${Date.now()}`
  await sheet.locator('#hr-dept-name').fill(name)
  await sheet.locator('#hr-dept-parent').click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.screenshot({ path: info.outputPath('hr-parent-selector.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await expect(sheet).toBeVisible()
  const saved = page.waitForResponse(r => r.url().endsWith(`/api/v1/hr/departments/${ids.departmentId}`) && r.request().method() === 'PATCH')
  await sheet.getByRole('button', { name: 'حفظ', exact: true }).click()
  expect((await saved).ok()).toBeTruthy()
  await expect.poll(async () => (await (await page.request.get(`/api/v1/hr/departments/${ids.departmentId}`)).json()).name).toBe(name)
  await page.reload()
  await expect(page.locator('#hr-dept-name')).toHaveValue(name)
})

test('chat composer sends through the real conversation and keeps the message after reload', async ({ page }, info) => {
  await page.goto(`/chat/${ids.conversationId}`)
  const composer = page.locator('textarea').last()
  const message = `رسالة فحص الثيم ${Date.now()}`
  await expect(composer).toBeEnabled()
  await composer.fill(message)
  const saved = page.waitForResponse(r => r.url().includes(`/api/v1/chat/conversations/${ids.conversationId}/messages`) && r.request().method() === 'POST')
  await composer.locator('xpath=ancestor::form').getByRole('button', { name: /إرسال/ }).click()
  expect((await saved).ok()).toBeTruthy()
  await page.reload()
  await expect(page.getByText(message, { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('chat-message-persisted.png'), fullPage: true })
})

test('meeting print keeps document geometry and hides interactive chrome', async ({ page }, info) => {
  await page.goto(`/meetings/${ids.meetingId}/print`)
  await expect(page.getByTestId('meeting-minutes-document')).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByTestId('shell-header')).not.toBeVisible()
  await expect(page.getByTestId('meeting-minutes-document')).toBeVisible()
  await page.screenshot({ path: info.outputPath('meeting-print-media.png'), fullPage: true })
})

test('module filter menus render all options without primitive errors', async ({ page }, info) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  for (const url of ['/meetings', '/hr', '/settings/users', '/settings/roles', '/settings/access-log', '/notifications']) {
    await page.goto(url)
    const trigger = page.locator('[data-slot="filter-root"]').getByRole('button').first()
    if (!(await trigger.count())) continue
    await trigger.click()
    const fields = page.locator('[data-slot="filter-fields"]')
    await expect(fields).toBeVisible()
    for (const [index, combo] of (await fields.getByRole('combobox').all()).entries()) {
      if (!(await combo.isEnabled())) continue
      await combo.click()
      await expect(page.getByRole('listbox')).toBeVisible()
      await page.screenshot({ path: info.outputPath(`filter-${url.replaceAll('/', '_')}-${index}.png`), fullPage: true })
      await page.keyboard.press('Escape')
      await expect(fields).toBeVisible()
    }
    await page.keyboard.press('Escape')
  }
  expect(errors).toEqual([])
})

test('shared header menus use the same theme on desktop and mobile', async ({ page }, info) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/tasks')
    await page.locator('[data-slot="header-account"]').click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.screenshot({ path: info.outputPath(`account-menu-${width}.png`), fullPage: true })
    await page.keyboard.press('Escape')
    await page.getByTestId('notification-bell').click()
    await expect(page.getByTestId('notification-preview')).toBeVisible()
    await page.screenshot({ path: info.outputPath(`notification-preview-${width}.png`), fullPage: true })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'بحث', exact: true }).click()
    await expect(page.locator('#global-search-input')).toBeVisible()
    await page.locator('#global-search-input').fill('فحص')
    await expect(page.locator('.nasq-search-results')).toBeVisible()
    await page.screenshot({ path: info.outputPath(`search-menu-${width}.png`), fullPage: true })
    await page.keyboard.press('Escape')
  }
})

test('HR table record number and mobile keyboard row open the real record', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/hr?q=' + encodeURIComponent('موظف مراجعة الواجهات'))
  const row = page.locator('table tbody tr').filter({ has: page.locator(`[data-testid="hr-employee-name"][href*="/hr/employees/${ids.employeeId}"]`) })
  await row.locator('td').first().click()
  await expect(page).toHaveURL(new RegExp(`/hr/employees/${ids.employeeId}`))
  await expect(page.locator('.nasq-ui-route-sheet')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto(`/hr/departments/${ids.departmentId}`)
  const card = page.getByRole('button').filter({ hasText: 'دليل الإجراءات' }).first()
  await card.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/documents/${ids.documentId}`))
})

test('meeting tabs keep keyboard selection, linked panels and route history', async ({ page }) => {
  await page.goto(`/meetings/${ids.meetingId}?tab=summary`)
  const tabs = page.getByRole('tablist')
  const summary = tabs.getByRole('tab').first()
  await expect(summary).toHaveAttribute('aria-selected', 'true')
  await summary.focus()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/tab=versions/)
  const selected = tabs.getByRole('tab', { selected: true })
  const panelId = await selected.getAttribute('aria-controls')
  expect(panelId).toBeTruthy()
  await expect(page.locator(`[id="${panelId}"]`)).toBeVisible()
  await page.reload()
  await expect(tabs.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true')
})

test('date labels and password validation errors retain real accessible associations', async ({ page }, info) => {
  await page.goto('/meetings/new')
  const date = page.locator('#meeting-date')
  await expect(date).toBeEnabled()
  const label = page.locator('label[for="meeting-date"]')
  await expect(label).toBeVisible()
  await label.click()
  await expect(page.locator('[data-slot="grid"]').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto('/account')
  await page.getByTestId('pw-submit').click()
  for (const name of ['pw-current', 'pw-new']) {
    const input = page.getByTestId(name)
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = await input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    for (const id of describedBy!.split(/\s+/)) {
      const error = page.locator(`[id="${id}"]`)
      await expect(error).toBeVisible()
      await expect(error.getByRole('alert')).toBeVisible()
    }
  }
  await page.screenshot({ path: info.outputPath('password-error-associations.png'), fullPage: true })
})


test('shared file picker uploads the actual task attachment and resets for another choice', async ({ page }, info) => {
  await page.goto(`/tasks/${ids.taskId}?fullPage=1`)
  const section = page.getByTestId('task-attachments')
  await page.locator('details').filter({ has: section }).locator(':scope > summary').click()
  const name = `theme-upload-${Date.now()}.txt`
  await expect(section.locator('#task-attachment-upload')).toBeEnabled()
  const uploaded = page.waitForResponse(r => r.url().includes(`/api/v1/tasks/${ids.taskId}/attachments`) && r.request().method() === 'POST')
  await section.locator('input[type="file"]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('Nasq shared file field verification') })
  expect((await uploaded).ok()).toBeTruthy()
  await expect(section.getByRole('link', { name, exact: true })).toBeVisible()
  await expect(section.locator('input[type="file"]')).toHaveValue('')
  await page.reload()
  await page.locator('details').filter({ has: page.getByTestId('task-attachments') }).locator(':scope > summary').click()
  await expect(page.getByTestId('task-attachments').getByRole('link', { name, exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('shared-file-upload-persisted.png'), fullPage: true })
})


test('shared non-solid actions remain readable in every appearance mode', async ({ page, context, baseURL }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const mode of ['light', 'dark', 'cream']) {
    await context.addCookies([{ name: 'nasq-appearance', value: encodeURIComponent(JSON.stringify({ mode, fontSize: 'small' })), url: baseURL! }])
    for (const [url, selector] of [[`/chat/${ids.conversationId}/info`, '.nasq-ui-secondary-text'], [`/project-templates/${ids.templateId}`, '.nasq-ui-primary-text'], [`/meetings/${ids.meetingId}?tab=versions`, '[role=tab][aria-selected=true]']]) {
    await page.goto(url!)
    const control = page.locator(selector!).filter({ visible: true }).first()
    await expect(control).toBeEnabled()
    const ratio = await control.evaluate(el => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d')!
      const luminance = (color: string) => {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        return r! * .2126 + g! * .7152 + b! * .0722
      }
      let background = 'rgb(255, 255, 255)'
      for (let node: Element | null = el; node; node = node.parentElement) {
        const value = getComputedStyle(node).backgroundColor
        if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') { background = value; break }
      }
      // Nuxt Tabs paints the selected background with a sibling indicator.
      if (el.getAttribute('aria-selected') === 'true') {
        const indicator = el.closest('[role="tablist"]')?.querySelector('[data-slot="indicator"]')
        if (indicator) background = getComputedStyle(indicator).backgroundColor
      }
      const foreground = luminance(getComputedStyle(el).color)
      const backdrop = luminance(background)
      return (Math.max(foreground, backdrop) + .05) / (Math.min(foreground, backdrop) + .05)
    })
    expect(ratio, `${mode} ${selector} action text contrast`).toBeGreaterThanOrEqual(4.5)
    await page.screenshot({ path: info.outputPath(`${mode}-${selector?.replace(/[^a-zA-Z0-9_-]/g, '')}.png`), fullPage: true, animations: 'disabled' })
    }
  }
})
