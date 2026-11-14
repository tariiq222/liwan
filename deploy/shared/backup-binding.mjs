// Resolve the capture source from the same published registry the guard trusts.
// The operator supplies the registry path; no user-supplied DB or filestore name.
import { readTenantRegistrySnapshot } from '../../apps/web/server/utils/tenantRegistry.ts'

const [registryPath, tenantId] = process.argv.slice(2)
try {
  const { hosts } = readTenantRegistrySnapshot(registryPath)
  // Suspension blocks requests, not protection of the tenant’s existing data: `enabled` is deliberately ignored.
  const target = Object.values(hosts).find(row => row.tenantId === tenantId)
  if (!target) throw new Error('tenant not bound')
  // A retired tenant (its workspace is being or has been deleted) is still resolved so the pipeline can name the outcome; only the pipeline refuses it.
  process.stdout.write(JSON.stringify({ database: target.database, filestore: target.filestore, retired: target.retired === true }))
} catch {
  process.stderr.write('tenant registry is unavailable or the tenant has no published binding\n')
  process.exitCode = 2
}
