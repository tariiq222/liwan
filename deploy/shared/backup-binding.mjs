// Resolve the capture source from the same published registry the guard trusts.
// The operator supplies the registry path; no user-supplied DB or filestore name.
import { readTenantRegistrySnapshot } from '../../apps/web/server/utils/tenantRegistry.ts'

const [registryPath, tenantId] = process.argv.slice(2)
try {
  const { hosts } = readTenantRegistrySnapshot(registryPath)
  // Suspension blocks requests, not protection of the tenant’s existing data.
  const target = Object.values(hosts).find(row => row.tenantId === tenantId)
  if (!target) throw new Error('tenant not bound')
  process.stdout.write(JSON.stringify({ database: target.database, filestore: target.filestore }))
} catch {
  process.stderr.write('tenant registry is unavailable or the tenant has no published binding\n')
  process.exitCode = 2
}
