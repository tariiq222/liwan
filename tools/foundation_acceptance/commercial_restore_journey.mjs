import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { isBoundaryDenial, waitFor } from './lib.mjs'

const reason = 'Isolated commercial restore acceptance'

function bodyAt(response, status, description) {
  assert.equal(response.status, status, `${description} (${response.body?.code ?? 'no_code'})`)
  return response.body
}

function scratchName(database) {
  assert.match(database, /^liwan_scratch_[a-f0-9]{32}$/)
  return database
}

export async function commercialRestoreJourney({ send, stepUp, compose, tenant, edge, record, domainSuffix }) {
  const prefix = `/v1/shared/tenants/${tenant.id}`
  const marker = `E14 attachment ${randomUUID()}`
  const sha = createHash('sha256').update(marker).digest('hex')
  const shell = (service, database, input) => {
    const result = compose(['exec', '-T', service, '/usr/local/bin/liwan-odoo', 'shell', '-d', scratchName(database), '--no-http', '--max-cron-threads=0'], { input })
    if (!result.ok) throw new Error(`${service} fixture shell failed`)
    return result.stdout
  }
  const seeded = shell('odoo', tenant.database, `
profile = env['liwan.tenant.profile'].search([], limit=1)
attachment = env['ir.attachment'].create({'name': 'E14.txt', 'raw': ${JSON.stringify(marker)}.encode(), 'res_model': 'res.company', 'res_id': profile.root_company_id.id})
assert attachment.store_fname
env.cr.commit()
print('E14_ATTACHMENT', attachment.id, profile.commercial_revision_id, profile.commercial_digest)
`)
  const fixture = seeded.match(/E14_ATTACHMENT (\d+) ([a-f0-9-]{36}) ([a-f0-9]{64})/)
  assert.ok(fixture, 'source attachment and applied policy are present')
  const readback = (service, database) => shell(service, database, `
import hashlib
profile = env['liwan.tenant.profile'].search([], limit=1)
attachment = env['ir.attachment'].browse(${fixture[1]}).exists()
assert attachment and attachment.store_fname and attachment.res_id == profile.root_company_id.id
print('E14_READBACK', profile.commercial_revision_id, profile.commercial_digest, hashlib.sha256(attachment.raw).hexdigest())
`).includes(`E14_READBACK ${fixture[2]} ${fixture[3]} ${sha}`)

  const submit = async job => bodyAt(await send(`${prefix}/jobs`, { body: { reason, job: { schemaVersion: 1, requestId: randomUUID(), ...job } } }), 202, `queue ${job.operation}`)
  const waitForJob = async id => {
    let progress
    await waitFor(async () => {
      progress = bodyAt(await send(`${prefix}/jobs/${id}`, { method: 'GET' }), 200, 'job progress')
      assert.notEqual(progress.state, 'needs_intervention', `${progress.operation} needs intervention`)
      return progress.state === 'verified'
    }, 'physical worker job verified', 15 * 60_000)
    return progress
  }
  await stepUp()
  const backup = await waitForJob((await submit({ operation: 'backup' })).id)
  assert.ok(backup.backupId, 'backup has a durable manifest')
  record('worker verified the database and filestore backup', true)
  const approval = bodyAt(await send(`${prefix}/restore-approvals`, { body: { backup_id: backup.backupId, reason } }), 201, 'restore approval')
  const targetHost = `r${approval.approval_id.replaceAll('-', '')}.restore.${domainSuffix}`
  record('restore host denied before reconciliation', isBoundaryDenial(await edge(targetHost, '/api/v1/me')))
  await waitForJob((await submit({ operation: 'restore', approvalId: approval.approval_id })).id)
  const publication = `${prefix}/restore-publications/${approval.approval_id}`
  await stepUp()
  bodyAt(await send(publication, { body: { reason } }), 202, 'request restore publication')
  await waitFor(async () => {
    const status = bodyAt(await send(publication, { method: 'GET' }), 200, 'restore publication progress')
    assert.notEqual(status.status, 'needs_intervention')
    if (status.status !== 'published') return false
    assert.equal(status.host, targetHost)
    return true
  }, 'verified commercial target is published')
  const registry = compose(['exec', '-T', 'guard', 'cat', '/etc/liwan-restore/registry.json'])
  assert.ok(registry.ok, 'read isolated restore registry')
  const target = JSON.parse(registry.stdout).targets.find(entry => entry.host === targetHost)
  assert.ok(target, 'published target matches the approval')
  assert.notEqual(target.database, tenant.database)
  record('restored Odoo and source both retain the applied policy and attachment SHA-256',
    readback('restore-odoo', target.database) && readback('odoo', tenant.database))
  const loginPage = await edge(targetHost, '/login')
  record('restored host serves its login page through the isolated TLS edge', loginPage.status === 200)
  return { backupId: backup.backupId, approvalId: approval.approval_id, host: targetHost, database: target.database, attachmentSha256: sha, appliedRevision: fixture[2] }
}
