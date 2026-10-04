// Real browser acceptance: no route mocks, seeded customer DB, or password logs.
import { test, expect } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const here = dirname(fileURLToPath(import.meta.url))
const state = JSON.parse(await readFile(join(here, '.state/current.json'), 'utf8'))
const run = `browser-${Date.now()}`
const output = join(state.stateDir, 'evidence', run)
await mkdir(output, { recursive: true, mode: 0o700 })
const proof = { project: state.projectName, run, checkpoints: [] }
async function checkpoint(name, details = {}) {
  proof.checkpoints.push({ name, at: new Date().toISOString(), ...details })
  await writeFile(join(output, 'first-tenant.json'), JSON.stringify(proof, null, 2), { mode: 0o600 })
  console.log(`Verified ${name}`)
}
async function login(page, origin, credentials) {
  await page.goto(`${origin}/login`)
  await page.getByLabel('اسم المستخدم', { exact: true }).fill(credentials.login)
  await page.getByLabel('كلمة المرور', { exact: true }).fill(credentials.password)
  const submit = page.getByRole('button', { name: 'دخول', exact: true })
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}
async function select(page, label, option) {
  const field = page.getByRole('combobox', { name: label })
  await field.click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
test('vendor creates a real Odoo tenant, whose administrator creates data and an attachment', async ({ page, browser }) => {
  let customer, app
  try {
    const vendor = JSON.parse(await readFile(join(state.stateDir, 'vendor-admin.json'), 'utf8'))
    await login(page, 'https://vendor.saas.commercial.nasq.test', vendor)
    await page.goto('https://vendor.saas.commercial.nasq.test/vendor/tenants/new')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('اسم العميل', { exact: true }).fill(`عميل قبول ${run}`)
    await select(page, 'إصدار الكتالوج', 'lifecycle-3899a095')
    await page.getByRole('combobox', { name: 'تركيبة الكتالوج' }).click()
    await page.getByRole('option').filter({ hasText: 'المشاريع' }).click()
    await page.getByLabel('اسم المسؤول', { exact: true }).fill('مسؤول قبول العميل')
    await page.getByLabel('اسم دخول المسؤول', { exact: true }).fill(`admin-${run}@accept.nasq.test`)
    await page.getByLabel('السبب', { exact: true }).fill('قبول محلي لتجهيز Odoo الحقيقي من لوحة الإدارة')
    const createdResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/vendor/v1/shared/tenants'))
    await page.getByRole('button', { name: 'تسجيل نسخة عميل', exact: true }).click()
    const response = await createdResponse
    expect(response.status()).toBe(202)
    const tenant = await response.json()
    expect(tenant.job_id).toMatch(/^[a-f0-9-]{36}$/)
    proof.tenant = tenant
    await checkpoint('vendor-browser-create', { tenantId: tenant.tenant_id, jobId: tenant.job_id, host: tenant.host })
    await expect(page).toHaveURL(new RegExp(`/vendor/tenants/${tenant.tenant_id}$`))
    const ready = page.getByRole('link', { name: 'فتح مساحة عمل العميل', exact: true })
    await expect(ready).toBeVisible({ timeout: 240_000 })
    await expect(ready).toHaveAttribute('href', `https://${tenant.host}/login`)
    await page.screenshot({ path: join(output, 'vendor-ready-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(ready).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: join(output, 'vendor-ready-mobile.png'), fullPage: true })
    await checkpoint('verified-active-route')
    const registry = JSON.parse(await readFile(join(state.stateDir, 'registry/registry.json'), 'utf8'))
    const binding = registry.targets.find(t => t.host === tenant.host)
    expect(binding.enabled).toBe(true)
    const credential = JSON.parse(await readFile(join(state.stateDir, 'credentials', `${binding.database}.json`), 'utf8'))
    customer = await browser.newContext({ locale: 'ar-SA', ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } })
    app = await customer.newPage()
    const origin = `https://${tenant.host}`
    await login(app, origin, credential)
    await checkpoint('customer-admin-browser-login', { database: binding.database })
    const projectName = `مشروع قبول ${run}`
    await app.goto(`${origin}/projects/new`)
    await expect(app.getByRole('dialog')).toBeVisible()
    await app.getByTestId('project-create-name').fill(projectName)
    let endDateChosen = false
    for (let i = 0; i < 10 && !(await app.getByTestId('charter-review-step').isVisible()); i++) {
      if (!endDateChosen && await app.getByTestId('project-create-end-date').isVisible()) {
        await app.getByTestId('project-create-end-date').click()
        await app.getByRole('gridcell').nth(20).getByRole('button').click()
        endDateChosen = true
      }
      const next = app.getByTestId('charter-step-next')
      await expect(next).toBeEnabled()
      await next.click()
    }
    await expect(app.getByTestId('charter-review-step')).toBeVisible()
    const projectResponse = app.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/projects')
    await app.getByTestId('project-create-submit').click()
    const projectResult = await projectResponse
    expect(projectResult.status()).toBe(201)
    const project = await projectResult.json()
    proof.projectId = project.id
    await expect(app).toHaveURL(url => url.pathname === `/projects/${project.id}/milestones`)
    await checkpoint('project-created', { projectId: project.id })
    await app.goto(`${origin}/projects/${project.id}/tasks/new`)
    const taskForm = app.getByTestId('task-create-form')
    await expect(taskForm).toBeVisible()
    const taskName = `مهمة قبول ${run}`
    await taskForm.getByLabel('عنوان المهمة', { exact: true }).fill(taskName)
    const taskResponse = app.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/tasks')
    await taskForm.locator('button[type="submit"]').click()
    const taskResult = await taskResponse
    expect(taskResult.status()).toBe(201)
    const taskData = await taskResult.json()
    proof.taskId = taskData.id
    await checkpoint('task-created', { taskId: taskData.id })
    await app.goto(`${origin}/tasks/${taskData.id}`)
    await app.getByRole('tab', { name: 'المرفقات', exact: true }).click()
    await expect(app.getByTestId('task-attachments')).toBeVisible()
    const fileName = `${run}.pdf`
    const bytes = Buffer.from(`%PDF-1.7\nNasq isolated acceptance ${run}\n%%EOF\n`)
    const uploadResponse = app.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/v1/tasks/${taskData.id}/attachments`)
    const chooser = app.waitForEvent('filechooser')
    await app.getByLabel('رفع ملف', { exact: true }).click()
    await (await chooser).setFiles({ name: fileName, mimeType: 'application/pdf', buffer: bytes })
    const uploaded = await uploadResponse
    expect(uploaded.status()).toBe(201)
    const attachment = await uploaded.json()
    proof.attachment = attachment
    const download = app.getByRole('link', { name: fileName, exact: true })
    await expect(download).toBeVisible()
    const href = await download.getAttribute('href')
    const fetched = await app.evaluate(async url => { const r = await fetch(url); return { status: r.status, bytes: Array.from(new Uint8Array(await r.arrayBuffer())) } }, href)
    expect(fetched.status).toBe(200)
    expect(Buffer.from(fetched.bytes)).toEqual(bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await app.reload()
    await app.getByRole('tab', { name: 'المرفقات', exact: true }).click()
    await expect(app.getByRole('link', { name: fileName, exact: true })).toBeVisible()
    await app.screenshot({ path: join(output, 'customer-task-attachment.png'), fullPage: true })
    await checkpoint('attachment-upload-download-refresh', { sha256, bytes: bytes.length })
    await checkpoint('milestone-one-accepted')
  } catch (error) {
    // The active vendor page contains no customer password. Credentials are
    // never serialized into evidence, traces or request dumps.
    if (!/\/login(?:\?|$)/.test(page.url())) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
    if (app && !/\/login(?:\?|$)/.test(app.url())) {
      await app.screenshot({ path: join(output, 'customer-failure.png'), fullPage: true }).catch(() => {})
      await writeFile(join(output, 'customer-failure.txt'), await app.locator('body').ariaSnapshot(), { mode: 0o600 }).catch(() => {})
    }
    await checkpoint('failed', { message: String(error.message).slice(0, 1200) })
    throw error
  } finally { await customer?.close() }
})
