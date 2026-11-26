import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Pool } from 'pg'
import { getConfig } from './config.js'
import { migrate, transaction } from './db.js'
import { readKnownSource } from './shared/catalog-source.js'
import { runCatalogCheck } from './shared/catalog-check.js'
import { assertCatalogCompatible, CatalogGateError } from './commercial/catalog-gate.js'
import { createRelease } from './commercial/catalog-releases.js'
import { pushCatalogEntitlement } from './commercial/catalog-entitlements.js'
import { CommercialHttpError } from './commercial/lifecycle.js'
import { lockOwners, normalizeEmail } from './admin-auth/accounts.js'
import { assertLoopbackDatabase, ensureDevOwner } from './admin-auth/dev-owner.js'
import { inviteAccount, issueReset } from './admin-auth/enrollment.js'

const config = getConfig()
const pool = new Pool({ connectionString: config.databaseUrl })
const [command, ...args] = process.argv.slice(2)
function adminOrThrow() {
  if (!config.admin) throw new Error('ADMIN_SECRET_KEY, ADMIN_RP_ID and ADMIN_ORIGIN are required')
  return config.admin
}
function reason(text: string | undefined): string {
  if (!text || text.trim().length < 3 || text.length > 1000) throw new Error('reason of 3-1000 characters required')
  return text.trim()
}
function uuid(text: string | undefined): string {
  if (!text || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text)) throw new Error('UUID required')
  return text
}
/** PostgreSQL refused a second row for one unique key: a concurrent import of the same version stored it first. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === '23505'
}
async function recordCatalogSyncFailed(version: string, error: unknown): Promise<void> {
  const code = error instanceof CatalogGateError || error instanceof CommercialHttpError
    ? error.code
    : typeof (error as { code?: unknown } | null)?.code === 'string'
      ? String((error as { code: string }).code)
      : (error instanceof Error ? error.message : 'catalog_sync_failed').slice(0, 200)
  const affectedCount = error instanceof CatalogGateError ? error.affected_count : 0
  const safeCode = code || 'catalog_sync_failed'
  await pool.query(
    'INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), 'operator', 'catalog.sync_failed', version, safeCode, JSON.stringify({ code: safeCode, affected_count: affectedCount })],
  )
}
try {
  await migrate(pool)
  if (command === 'bootstrap-owner') {
    const [email, displayName, why] = args
    const admin = adminOrThrow()
    const { token } = await transaction(pool, async (client) => {
      // lockOwners takes the owners advisory lock; the check below also counts enrolling owners.
      await lockOwners(client)
      const existing = await client.query("SELECT 1 FROM vendor_account_roles r JOIN vendor_accounts a ON a.id=r.account_id WHERE r.role='owner' AND a.status<>'disabled'")
      if (existing.rowCount) throw new Error('owner already exists')
      return inviteAccount(client, 'operator', { email: email ?? '', displayName: displayName ?? '', roles: ['owner'], reason: reason(why) }, new Date())
    })
    process.stdout.write(`${admin.origin}/enroll#${token}\n`)
  } else if (command === 'dev-owner') {
    const [email, displayName] = args
    assertLoopbackDatabase(config.databaseUrl)
    const normalized = normalizeEmail(email ?? '')
    // The same gate as the sign-in routes: a configured dev email on a loopback http setup, and that very email.
    if (adminOrThrow().devLoginEmail !== normalized) throw new Error('dev-owner requires ADMIN_DEV_LOGIN_EMAIL to equal the given email')
    if (!displayName?.trim() || displayName.length > 120) throw new Error('display name of 1-120 characters required')
    const { id, created } = await transaction(pool, (client) => ensureDevOwner(client, normalized, displayName.trim()))
    process.stdout.write(`${created ? 'created' : 'already exists, ensured owner role'}: account ${id}\n`)
  } else if (command === 'reset-account') {
    const [email, why] = args
    const admin = adminOrThrow()
    const { token } = await transaction(pool, async (client) => {
      const found = await client.query("SELECT id FROM vendor_accounts WHERE email=$1 AND status<>'disabled'", [normalizeEmail(email ?? '')])
      if (!found.rowCount) throw new Error('active account not found')
      return issueReset(client, 'operator', Number(found.rows[0].id), reason(why), new Date())
    })
    process.stdout.write(`${admin.origin}/enroll#${token}\n`)
  } else if (command === 'catalog-import') {
    const [version, why] = args
    if (!version || !/^[a-zA-Z0-9._-]{1,100}$/.test(version)) throw new Error('valid catalog version required')
    // Optional --source <file> is restricted to a registered file under deploy/catalog/solutions.
    const at = args.indexOf('--source')
    const resolved = await readKnownSource(config.repositoryRoot, at >= 0 ? args[at + 1] : undefined)
    const source = resolved.bytes
    // Import validates itself: a catalog the repository check refuses is never stored, and publish runs the same check again.
    await runCatalogCheck({ python: config.python, repositoryRoot: config.repositoryRoot })
    const whyReason = reason(why)
    const sourceSha256 = createHash('sha256').update(source).digest('hex')
    const existing = await pool.query('SELECT id,status,source_sha256 FROM catalog_entries WHERE version=$1', [version])
    const importOver = async (row: { id: string; status: string; source_sha256: string }): Promise<void> => {
      // One version stands for one catalog: changed bytes are a new version, never a silent replacement.
      if (row.source_sha256 !== sourceSha256) throw new Error(`catalog version ${version} already exists with different source bytes; import a new version`)
      if (row.status === 'draft') {
        // A draft imported before the check existed: the bytes are the current catalog, so it becomes validated now.
        // The UPDATE re-checks the status, so a draft a concurrent import already lifted writes no second audit event.
        const lifted = await transaction(pool, async (client) => {
          const updated = await client.query("UPDATE catalog_entries SET status='validated' WHERE id=$1 AND status='draft' RETURNING id", [row.id])
          if (!updated.rowCount) return null
          await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(), 'operator', 'catalog.validate', row.id, whyReason])
          return row.id
        })
        if (lifted) process.stdout.write(`${lifted}\n`)
        else {
          const current = await pool.query('SELECT status FROM catalog_entries WHERE id=$1', [row.id])
          process.stderr.write(`catalog version ${version} is already ${current.rows[0]?.status ?? row.status}; nothing to do\n`)
        }
      } else process.stderr.write(`catalog version ${version} is already ${row.status}; nothing to do\n`)
    }
    if (existing.rowCount) await importOver(existing.rows[0])
    else {
      const id = randomUUID()
      const solution = JSON.parse(source.toString('utf8'))
      try {
        await transaction(pool, async (client) => {
          await client.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'validated',$3,$4)", [id, version, solution, sourceSha256])
          await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(), 'operator', 'catalog.imported', id, whyReason])
        })
        process.stdout.write(`${id}\n`)
      } catch (error) {
        // Two concurrent imports of a new version both passed the SELECT; the loser re-reads the winner's row and reports it through the same branch as a pre-existing one.
        if (!isUniqueViolation(error)) throw error
        const raced = await pool.query('SELECT id,status,source_sha256 FROM catalog_entries WHERE version=$1', [version])
        if (!raced.rowCount) throw error
        await importOver(raced.rows[0])
      }
    }
  } else if (command === 'catalog-sync') {
    const [version, why] = args
    if (!version || !/^[a-zA-Z0-9._-]{1,100}$/.test(version)) throw new Error('valid catalog version required')
    const whyReason = reason(why)
    const at = args.indexOf('--source')
    const sourceArg = at >= 0 ? args[at + 1] : undefined
    try {
      const resolved = await readKnownSource(config.repositoryRoot, sourceArg)
      await runCatalogCheck({ python: config.python, repositoryRoot: config.repositoryRoot })
      const source = resolved.bytes
      const sourceSha256 = createHash('sha256').update(source).digest('hex')
      const solution = JSON.parse(source.toString('utf8')) as Record<string, unknown>
      const lockClient = await pool.connect()
      let locked = false
      try {
        await lockClient.query("SELECT pg_advisory_lock(hashtextextended('catalog-sync:' || $1, 0))", [version])
        locked = true
        const existing = await pool.query('SELECT id,status,source_sha256 FROM catalog_entries WHERE version=$1', [version])
        let alreadySynced = false
        let alreadyPublished = false
        if (existing.rowCount) {
          const row = existing.rows[0] as { id: string; status: string; source_sha256: string }
          if (row.source_sha256 !== sourceSha256) {
            throw Object.assign(new Error(`catalog version ${version} already exists with different source bytes`), { code: 'catalog_source_mismatch' })
          }
          if (row.status === 'published') {
            alreadyPublished = true
            const existingRelease = await pool.query('SELECT id FROM catalog_releases WHERE catalog_version=$1', [version])
            if (existingRelease.rowCount) {
              const releaseId = String(existingRelease.rows[0].id)
              const push = await pushCatalogEntitlement(pool, { id: releaseId })
              process.stdout.write(`${JSON.stringify({ status: 'already_synced', version, release_id: releaseId, pushed: push.pushed, failed: push.failed })}\n`)
              alreadySynced = true
            }
          }
        }
        if (!alreadySynced) {
          await transaction(pool, async (client) => {
            await assertCatalogCompatible(client, solution, version)
            if (!existing.rowCount) {
              const id = randomUUID()
              await client.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256,published_at) VALUES($1,$2,'published',$3,$4,now())", [id, version, solution, sourceSha256])
              await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(), 'operator', 'catalog.imported', id, whyReason])
              await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(), 'operator', 'catalog.publish', id, whyReason])
            } else if (!alreadyPublished) {
              const rowId = String(existing.rows[0].id)
              await client.query("UPDATE catalog_entries SET status='published',published_at=now() WHERE id=$1 AND status IN ('draft','validated')", [rowId])
              await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(), 'operator', 'catalog.publish', rowId, whyReason])
            }
          })
          const r = await createRelease(pool, { issuer: 'operator', actorUid: 0 }, { catalog_version: version, reason: whyReason })
          const push = await pushCatalogEntitlement(pool, r.release)
          process.stdout.write(`${JSON.stringify({ status: 'synced', version, release_id: r.release.id, pushed: push.pushed, failed: push.failed })}\n`)
        }
      } finally {
        if (locked) {
          try { await lockClient.query("SELECT pg_advisory_unlock(hashtextextended('catalog-sync:' || $1, 0))", [version]) } catch { /* connection closing */ }
        }
        lockClient.release()
      }
    } catch (error) {
      await recordCatalogSyncFailed(version, error)
      throw error
    }
  } else if (command === 'approve-restore') {
    const [tenantText, backupId, why] = args
    const tenantId = uuid(tenantText)
    if (!backupId || !/^op_[a-f0-9]{32}$/.test(backupId)) throw new Error('durable backup receipt ID required')
    const id = randomUUID()
    await transaction(pool, async (client) => {
      const backup = await client.query("SELECT 1 FROM operations WHERE tenant_id=$1 AND type='backup' AND status='succeeded' AND result->>'backup_id'=$2", [tenantId, backupId])
      if (!backup.rowCount) throw new Error('matching successful candidate backup is required')
      await client.query("INSERT INTO restore_approvals(id,tenant_id,backup_id,action,expires_at) VALUES($1,$2,$3,'restore',now()+interval '1 hour')", [id, tenantId, backupId])
      await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(),'operator','restore.approved',tenantId,reason(why)])
    })
    process.stdout.write(`${id}\n`)
  } else throw new Error('commands: bootstrap-owner, dev-owner (local development only), reset-account (the recovery path for a lost or last owner), catalog-import, catalog-sync, approve-restore')
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'admin command failed'}\n`)
  process.exitCode = 1
} finally { await pool.end() }
