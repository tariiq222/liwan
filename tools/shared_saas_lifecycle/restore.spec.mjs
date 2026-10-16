// NOT RUN since the vendor console moved to apps/vendor-admin (decision D2: no /vendor page prefix; the BFF API stays /api/vendor/v1/...).
// Now needs: a bootstrapped vendor owner (`npm -w apps/control-plane run admin -- bootstrap-owner ...`, link `<admin origin>/enroll#...`),
// a virtual WebAuthn authenticator in the browser context, and the vendor host serving apps/vendor-admin. The shared `login()` helper
// (username/password on /login) still targets the customer form and must be replaced for the vendor host before this spec can run.
// Captures/restores through the real signed queue. Local operator publishes only verified targets.
import { test, expect } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { state, here, acceptedPair, login, browserFetch } from './browser-helpers.mjs'
const exec = promisify(execFile), root = resolve(here, '../..')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
async function compose(args) {
  return exec('python3', ['tools/shared_saas_lifecycle/lifecycle.py', 'compose', ...args], { cwd: root, timeout: 180_000, maxBuffer: 1024 * 1024 })
}
async function api(page, tenant, suffix, body) {
  const response = await browserFetch(page, `/api/vendor/v1/shared/tenants/${tenant}/${suffix}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  return { status: response.status, data: JSON.parse(response.text) }
}
async function verified(page, tenant, id) {
  let result
  await expect.poll(async () => {
    result = await api(page, tenant, `jobs/${id}`)
    expect(result.status).toBe(200)
    if (result.data.state === 'needs_intervention') throw new Error(`Job ${id} requires intervention`)
    return result.data.state
  }, { timeout: 240_000, intervals: [1000, 2000, 4000] }).toBe('verified')
  return result.data
}
async function restoredReadback(browser, original, target, output) {
  const context = await browser.newContext({ locale: 'ar-SA', ignoreHTTPSErrors: true })
  try {
    const page = await context.newPage()
    await login(page, `https://${target.host}`, original.credentials)
    await page.goto(`https://${target.host}/projects/${original.projectId}/milestones`)
    await expect(page.locator('body')).toContainText(`مشروع قبول ${original.run}`)
    await page.goto(`https://${target.host}/tasks/${original.taskId}`)
    await expect(page.locator('body')).toContainText(`مهمة قبول ${original.run}`)
    await page.getByRole('tab', { name: 'المرفقات', exact: true }).click()
    const download = page.getByRole('link', { name: `${original.run}.pdf`, exact: true })
    await expect(download).toBeVisible()
    const path = await download.getAttribute('href')
    const actual = await page.evaluate(async path => {
      const response = await fetch(path)
      return { status: response.status, bytes: [...new Uint8Array(await response.arrayBuffer())] }
    }, path)
    const expected = original.checkpoints.find(s => s.name === 'attachment-upload-download-refresh')
    expect(actual.status).toBe(200); expect(actual.bytes.length).toBe(expected.bytes)
    expect(sha256(Buffer.from(actual.bytes))).toBe(expected.sha256)
    await page.screenshot({ path: join(output, `${target.approvalId}-restored.png`), fullPage: true })
    return { host: target.host, database: target.database, projectId: original.projectId, taskId: original.taskId, attachmentId: original.attachment.id, sha256: expected.sha256, bytes: expected.bytes }
  } finally { await context.close() }
}
test('A and B real database and filestore backups restore to separate new targets', async ({ page, browser }) => {
  const pair = await acceptedPair(), proof = { project: state.projectName, sources: pair.map(t => t.evidencePath), steps: [] }
  const output = join(state.stateDir, 'evidence', `restore-${Date.now()}`)
  await mkdir(output, { recursive: true, mode: 0o700 })
  const save = async () => writeFile(join(output, 'restore.json'), JSON.stringify(proof, null, 2), { mode: 0o600 })
  const originalRegistry = await readFile(join(state.stateDir, 'registry/registry.json'), 'utf8')
  const vendor = JSON.parse(await readFile(join(state.stateDir, 'vendor-admin.json'), 'utf8'))
  await login(page, 'https://vendor.saas.accept.nasq.test', vendor)
  const actor = await browserFetch(page, '/api/v1/me'); expect(actor.status).toBe(200)
  const actorUid = JSON.parse(actor.text).id
  for (const [index, original] of pair.entries()) {
    const tenantId = original.tenant.tenant_id, backupRequest = randomUUID()
    const captured = await api(page, tenantId, 'jobs', { reason: 'قبول نسخة فعلية لقاعدة Odoo وملفاتها', job: { schemaVersion: 1, requestId: backupRequest, operation: 'backup' } })
    expect(captured.status).toBe(202)
    proof.steps.push({ tenantId, step: 'backup-enqueued', jobId: captured.data.id, requestId: backupRequest }); await save()
    const backup = await verified(page, tenantId, captured.data.id)
    expect(backup.backupId).toMatch(/^[a-f0-9-]{36}$/)
    proof.steps.push({ tenantId, step: 'backup-verified', ...backup }); await save()
    const wrongTenant = await api(page, pair[1-index].tenant.tenant_id, 'restore-approvals', { backup_id: backup.backupId, reason: 'قبول رفض النسخة التابعة لعميل آخر' })
    expect([400, 403, 409]).toContain(wrongTenant.status)
    proof.steps.push({ tenantId, step: 'foreign-backup-approval-rejected', status: wrongTenant.status }); await save()
    const approval = await api(page, tenantId, 'restore-approvals', { backup_id: backup.backupId, reason: 'قبول استعادة محلية إلى هدف جديد مستقل' })
    expect([200, 201]).toContain(approval.status)
    const restoreRequest = { schemaVersion: 1, requestId: randomUUID(), operation: 'restore', approvalId: approval.data.approval_id }
    const foreignApproval = await api(page, pair[1-index].tenant.tenant_id, 'jobs', { reason: 'قبول رفض موافقة عميل آخر', job: restoreRequest })
    expect([400, 403, 409]).toContain(foreignApproval.status)
    const forgedTarget = await api(page, tenantId, 'jobs', { reason: 'قبول رفض اختيار هدف من المتصفح', job: { ...restoreRequest, targetDatabase: original.binding.database } })
    expect([400, 422]).toContain(forgedTarget.status)
    proof.steps.push({ tenantId, step: 'foreign-approval-and-caller-target-rejected', foreignApprovalStatus: foreignApproval.status, callerTargetStatus: forgedTarget.status }); await save()
    const restored = await api(page, tenantId, 'jobs', { reason: 'قبول استعادة فعلية ومقارنة البيانات والمرفقات', job: restoreRequest })
    expect(restored.status).toBe(202)
    proof.steps.push({ tenantId, step: 'restore-enqueued', approvalId: approval.data.approval_id, jobId: restored.data.id }); await save()
    await verified(page, tenantId, restored.data.id)
    const reused = await api(page, tenantId, 'jobs', { reason: 'قبول رفض إعادة استخدام موافقة مستهلكة', job: { ...restoreRequest, requestId: randomUUID() } })
    expect([400, 403, 409]).toContain(reused.status)
    const replay = await api(page, tenantId, 'jobs', { reason: 'قبول إعادة قراءة الطلب نفسه دون أثر جديد', job: restoreRequest })
    expect(replay.status).toBe(200); expect(replay.data.id).toBe(restored.data.id); expect(replay.data.replay).toBe(true)
    const published = await compose(['exec', '-T', 'control-worker', 'node', '--import', 'tsx', 'tools/shared_saas_lifecycle/operator_restore.mjs', 'publish', '--approval', approval.data.approval_id, '--actor', String(actorUid)])
    const target = JSON.parse(published.stdout)
    expect(target.database).not.toBe(original.binding.database)
    await compose(['--profile', 'restore', 'up', '-d', '--wait', 'restore-guard'])
    const readback = await restoredReadback(browser, original, target, output)
    proof.steps.push({ tenantId, step: 'restored-browser-accepted', ...readback, approvalId: target.approvalId, reusedApprovalStatus: reused.status, replayJobId: replay.data.id }); await save()
    // Read originals after each capture/restore, including the other tenant.
    for (const source of pair) {
      const sourceView = { host: source.binding.host, database: source.binding.database, approvalId: `source-${index}-${source.tenant.tenant_id}` }
      await restoredReadback(browser, source, sourceView, output)
    }
    expect(await readFile(join(state.stateDir, 'registry/registry.json'), 'utf8')).toBe(originalRegistry)
    proof.steps.push({ tenantId, step: 'both-originals-intact-and-registry-unchanged' }); await save()
  }
  proof.accepted = true; proof.completedAt = new Date().toISOString(); await save()
})
