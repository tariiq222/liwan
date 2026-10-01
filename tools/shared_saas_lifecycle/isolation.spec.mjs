// Real edge + browser proof. Cookies stay in memory; evidence has no credentials.
import { test, expect } from '@playwright/test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { state, acceptedPair, login, browserFetch, edge } from './browser-helpers.mjs'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
test('two worker-created Odoo tenants reject cross-host sessions and database selectors in both directions', async ({ browser }) => {
  const pair = await acceptedPair(), contexts = [], proof = []
  const output = join(state.stateDir, 'evidence', `isolation-${Date.now()}`)
  await mkdir(output, { recursive: true, mode: 0o700 })
  try {
    for (const t of pair) {
      const ctx = await browser.newContext({ locale: 'ar-SA', ignoreHTTPSErrors: true }); contexts.push(ctx)
      const page = await ctx.newPage(); await login(page, t.origin, t.credentials)
      await page.goto(`${t.origin}/tasks/${t.taskId}`)
      await expect(page.locator('body')).toContainText(`مهمة قبول ${t.run}`)
      await page.getByRole('tab', { name: 'المرفقات', exact: true }).click()
      const link = page.getByRole('link', { name: `${t.run}.pdf`, exact: true })
      await expect(link).toBeVisible(); t.downloadPath = await link.getAttribute('href')
      t.page = page
      const sid = (await ctx.cookies(t.origin)).find(c => c.name === 'session_id')
      if (!sid) throw new Error('Missing signed tenant session')
      t.cookie = `session_id=${sid.value}`
      await page.screenshot({ path: join(output, `${t.tenant.tenant_id}.png`), fullPage: true })
    }
    for (const [index, t] of pair.entries()) {
      const other = pair[1-index]
      const expectedHash = t.checkpoints.find(s => s.name === 'attachment-upload-download-refresh').sha256
      const ownTask = await browserFetch(t.page, `/api/v1/tasks/${other.taskId}`)
      expect(ownTask.status).toBe(200)
      expect(JSON.parse(ownTask.text).name).toBe(`مهمة قبول ${t.run}`)
      expect(ownTask.text).not.toContain(other.run)
      const download = await edge(t.binding.host, t.downloadPath, t.cookie)
      expect(download.status).toBe(200); expect(hash(download.body)).toBe(expectedHash)
      // The equal numeric ids deliberately collide; the host must resolve only its own bytes.
      const foreignPath = new URL(other.downloadPath, other.origin).pathname
      const collision = await edge(t.binding.host, foreignPath, t.cookie)
      expect(collision.status).toBe(200); expect(hash(collision.body)).toBe(expectedHash)
      for (const path of ['/api/v1/me', `/api/v1/tasks/${t.taskId}`, t.downloadPath]) {
        const denied = await edge(t.binding.host, path, other.cookie)
        expect(denied.status).toBe(403); expect(denied.body.toString()).toBe('tenant_boundary_rejected')
        proof.push({ tenant: t.tenant.tenant_id, check: 'foreign-session', path, status: denied.status })
      }
      for (const key of ['db', 'database']) {
        const denied = await browserFetch(t.page, `/api/v1/tasks/${t.taskId}?${key}=${other.binding.database}`)
        expect(denied.status).toBe(403)
        proof.push({ tenant: t.tenant.tenant_id, check: `selector-${key}`, status: denied.status })
      }
      const bodySelector = await browserFetch(t.page, '/api/v1/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'forbidden selector', nested: { db: other.binding.database } }) })
      expect(bodySelector.status).toBe(400)
      const spoof = await edge(t.binding.host, '/api/v1/me', t.cookie, { 'X-Odoo-Db': other.binding.database })
      expect(spoof.status).toBe(403)
      const unknown = await edge('unknown.saas.accept.nasq.test', '/api/v1/me', t.cookie)
      expect(unknown.status).toBe(403)
      proof.push({ tenant: t.tenant.tenant_id, check: 'own-record-and-attachment-collision', sha256: expectedHash, status: 200 },
        { tenant: t.tenant.tenant_id, check: 'body-selector', status: bodySelector.status },
        { tenant: t.tenant.tenant_id, check: 'header-selector', status: spoof.status },
        { tenant: t.tenant.tenant_id, check: 'unknown-host', status: unknown.status })
    }
    await writeFile(join(output, 'isolation.json'), JSON.stringify({ project: state.projectName, accepted: true, at: new Date().toISOString(), sources: pair.map(t => t.evidencePath), checks: proof }, null, 2), { mode: 0o600 })
  } finally { for (const ctx of contexts) await ctx.close() }
})
