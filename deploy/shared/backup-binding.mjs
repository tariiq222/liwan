// Resolve the capture source from the same published registry the guard trusts.
// The operator supplies the registry path; no user-supplied DB or filestore name.
// `<registry> <tenantId>` resolves one tenant; `--list <registry>` prints every non-retired tenant.
import { readTenantRegistrySnapshot } from '../../apps/web/server/utils/tenantRegistry.ts'

const args = process.argv.slice(2)
const listing = args[0] === '--list'
const [registryPath, tenantId] = listing ? args.slice(1) : args
try {
  const { hosts } = readTenantRegistrySnapshot(registryPath)
  if (listing) {
    // A tenant owns one database however many hostnames point at it; a retired tenant is not a backup target.
    const live = new Map()
    for (const row of Object.values(hosts)) {
      if (row.retired !== true && !live.has(row.tenantId)) live.set(row.tenantId, { tenantId: row.tenantId, database: row.database, filestore: row.filestore, enabled: row.enabled })
    }
    process.stdout.write(JSON.stringify([...live.values()]))
  } else {
    // Suspension blocks requests, not protection of the tenant’s existing data: `enabled` is deliberately ignored.
    const target = Object.values(hosts).find(row => row.tenantId === tenantId)
    if (!target) throw new Error('tenant not bound')
    // A retired tenant (its workspace is being or has been deleted) is still resolved so the pipeline can name the outcome; only the pipeline refuses it.
    process.stdout.write(JSON.stringify({ database: target.database, filestore: target.filestore, retired: target.retired === true }))
  }
} catch {
  process.stderr.write('tenant registry is unavailable or the tenant has no published binding\n')
  process.exitCode = 2
}
