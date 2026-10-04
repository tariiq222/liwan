import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Pool } from 'pg'
import { vendorCapabilitySchema } from '@nasq/commercial-contracts'
import { getConfig } from './config.js'
import { migrate, transaction } from './db.js'
import { writeFile } from 'node:fs/promises'
import { readKnownSource } from './shared/catalog-source.js'
import { migrateLegacyToSaas } from './commercial/legacy-mapping.js'

const config = getConfig()
const pool = new Pool({ connectionString: config.databaseUrl })
const [command, ...args] = process.argv.slice(2)
function positiveUid(text: string | undefined): number {
  if (!text || !/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(Number(text))) throw new Error('positive Odoo user ID required')
  return Number(text)
}
function reason(text: string | undefined): string {
  if (!text || text.trim().length < 3 || text.length > 1000) throw new Error('reason of 3-1000 characters required')
  return text.trim()
}
function uuid(text: string | undefined): string {
  if (!text || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text)) throw new Error('UUID required')
  return text
}
try {
  await migrate(pool)
  if (command === 'grant') {
    const [uidText, capabilityText, why] = args
    const uid = positiveUid(uidText)
    const capabilities = capabilityText?.split(',').map((capability) => vendorCapabilitySchema.parse(capability))
    if (!capabilities?.length || new Set(capabilities).size !== capabilities.length) throw new Error('unique capability list required')
    await transaction(pool, async (client) => {
      await client.query('INSERT INTO vendor_memberships(issuer,actor_uid,capabilities,revoked_at) VALUES($1,$2,$3,NULL) ON CONFLICT(issuer,actor_uid) DO UPDATE SET capabilities=EXCLUDED.capabilities,revoked_at=NULL', [config.installationId, uid, capabilities])
      await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(),'operator','membership.granted',String(uid),reason(why)])
    })
  } else if (command === 'revoke') {
    const [uidText, why] = args
    const uid = positiveUid(uidText)
    await transaction(pool, async (client) => {
      const row = await client.query('UPDATE vendor_memberships SET revoked_at=now() WHERE issuer=$1 AND actor_uid=$2 AND revoked_at IS NULL RETURNING actor_uid', [config.installationId, uid])
      if (!row.rowCount) throw new Error('active membership not found')
      await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(),'operator','membership.revoked',String(uid),reason(why)])
    })
  } else if (command === 'catalog-import') {
    const [version, why] = args
    if (!version || !/^[a-zA-Z0-9._-]{1,100}$/.test(version)) throw new Error('valid catalog version required')
    // Optional --source <file> is restricted to a registered file under deploy/catalog/solutions.
    const at = args.indexOf('--source')
    const resolved = await readKnownSource(config.repositoryRoot, at >= 0 ? args[at + 1] : undefined)
    const source = resolved.bytes
    const solution = JSON.parse(source.toString('utf8'))
    const id = randomUUID()
    await transaction(pool, async (client) => {
      await client.query('INSERT INTO catalog_entries(id,version,solution,source_sha256) VALUES($1,$2,$3,$4)', [id, version, solution, createHash('sha256').update(source).digest('hex')])
      await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(),'operator','catalog.imported',id,reason(why)])
    })
    process.stdout.write(`${id}\n`)
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
  } else if (command === 'migrate-saas-commercial') {
    const mode = args.includes('--run') ? 'run' : args.includes('--dry-run') ? 'dry_run' : undefined
    if (!mode || (args.includes('--run') && args.includes('--dry-run'))) throw new Error('exactly one of --dry-run or --run required')
    const at = args.indexOf('--report')
    const report = await migrateLegacyToSaas(pool, { mode })
    const text = JSON.stringify(report, null, 2)
    if (at >= 0) { if (!args[at + 1]) throw new Error('--report path required'); await writeFile(args[at + 1]!, `${text}\n`) }
    process.stdout.write(`${text}\n`)
    if (report.counts.errors) process.exitCode = 2
  } else throw new Error('commands: grant, revoke, catalog-import, approve-restore, migrate-saas-commercial')
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'admin command failed'}\n`)
  process.exitCode = 1
} finally { await pool.end() }
