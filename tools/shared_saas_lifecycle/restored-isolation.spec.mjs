import { test, expect } from '@playwright/test'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { state, acceptedPair, login, edge } from './browser-helpers.mjs'

test('original and restored A/B sessions are rejected at every other host', async ({ browser }) => {
  const pair = await acceptedPair(), contexts = [], checks = [], root = join(state.stateDir, 'evidence')
  const attempts = (await readdir(root)).filter(x => x.startsWith('restore-')).sort().reverse()
  let restore
  for (const dir of attempts) {
    const raw = await readFile(join(root, dir, 'restore.json'), 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e })
    if (raw) { const candidate = JSON.parse(raw); if (candidate.accepted && pair.every(t => candidate.sources.includes(t.evidencePath))) { restore = candidate; break } }
  }
  expect(restore, 'Complete restore evidence for this exact source pair required').toBeTruthy()
  const targets = pair.flatMap(source => {
    const target = restore.steps.find(s => s.tenantId === source.tenant.tenant_id && s.step === 'restored-browser-accepted')
    expect(target).toBeTruthy()
    return [{ source, host: source.binding.host, kind: 'original' }, { source, host: target.host, kind: 'restored' }]
  })
  const output = join(root, `restored-isolation-${Date.now()}`); await mkdir(output, { recursive: true, mode: 0o700 })
  try {
    for (const target of targets) {
      const context = await browser.newContext({ locale: 'ar-SA', ignoreHTTPSErrors: true }); contexts.push(context)
      const page = await context.newPage(); await login(page, `https://${target.host}`, target.source.credentials)
      const sid = (await context.cookies(`https://${target.host}`)).find(c => c.name === 'session_id')
      if (!sid) throw new Error('No signed cookie after login')
      target.cookie = `session_id=${sid.value}`
    }
    for (const target of targets) {
      const source = target.source, path = source.attachment.url
      const own = await edge(target.host, path, target.cookie)
      const expected = source.checkpoints.find(s => s.name === 'attachment-upload-download-refresh').sha256
      expect(own.status).toBe(200); expect(createHash('sha256').update(own.body).digest('hex')).toBe(expected)
      checks.push({ host: target.host, check: 'own-attachment', status: own.status, sha256: expected })
      for (const foreign of targets.filter(t => t !== target)) {
        for (const route of [`/api/v1/tasks/${source.taskId}`, path]) {
          const response = await edge(target.host, route, foreign.cookie)
          expect(response.status).toBe(403); expect(response.body.toString()).toBe('tenant_boundary_rejected')
          checks.push({ host: target.host, foreignHost: foreign.host, route, check: 'foreign-cookie', status: response.status })
        }
      }
    }
    await writeFile(join(output, 'matrix.json'), JSON.stringify({ project: state.projectName, accepted: true, at: new Date().toISOString(), sources: pair.map(t => t.evidencePath), checks }, null, 2), { mode: 0o600 })
  } finally { for (const context of contexts) await context.close() }
})
