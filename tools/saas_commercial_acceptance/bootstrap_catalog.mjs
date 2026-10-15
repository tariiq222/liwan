// Operator-only fixture setup inside the isolated control-api container.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import https from 'node:https'
import { Pool } from 'pg'
import { signServiceRequest } from '@nasq/commercial-contracts/server'
const actor = Number(process.argv[2])
if (!Number.isSafeInteger(actor) || actor <= 1) throw Error('vendor fixture UID required')
// Signed service call to the control API, as the vendor fixture actor.
async function post(path, payload) {
  const body = JSON.stringify(payload)
  const headers = signServiceRequest({ method: 'POST', path, body, actor, issuer: process.env.CONTROL_INSTALLATION_ID, key: process.env.CONTROL_SERVICE_KEY })
  return new Promise((resolve, reject) => {
    const req = https.request(`https://control-api:4187${path}`, { method: 'POST', ca: readFileSync(process.env.CONTROL_TLS_CERT), headers: { ...headers, 'content-type': 'application/json' } }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }))
    }); req.on('error', reject); req.end(body)
  })
}
const pool = new Pool({ connectionString: process.env.CONTROL_DATABASE_URL })
try {
  execFileSync('npm', ['-w', 'apps/control-plane', 'run', 'admin', '--', 'grant', String(actor),
    // Customer creation needs subscriptions.manage; the journey also prices plans and settles invoices.
    'vendor.read,vendor.tenants.manage,vendor.catalog.manage,vendor.operations.run,vendor.audit.read,vendor.subscriptions.manage,vendor.pricing.manage,vendor.billing.manage',
    'Isolated commercial acceptance fixture'], { stdio: 'pipe' })
  const version = 'commercial-acceptance-v2'
  const expectedSource = createHash('sha256').update(readFileSync(new URL('../../deploy/catalog/solutions/platform_v2.json', import.meta.url))).digest('hex')
  let row = (await pool.query('SELECT id,status,source_sha256 FROM catalog_entries WHERE version=$1', [version])).rows[0]
  if (!row) {
    execFileSync('npm', ['-w', 'apps/control-plane', 'run', 'admin', '--', 'catalog-import', version, 'Isolated commercial acceptance fixture', '--source', 'platform_v2.json'], { stdio: 'pipe' })
    row = (await pool.query('SELECT id,status,source_sha256 FROM catalog_entries WHERE version=$1', [version])).rows[0]
  }
  if (row.source_sha256 !== expectedSource) throw Error('Commercial fixture catalog source mismatch; preserve the existing revision')
  for (const action of row.status === 'draft' ? ['validate', 'publish'] : row.status === 'validated' ? ['publish'] : []) {
    const response = await post(`/v1/catalog/${row.id}/${action}`, { reason: 'Isolated local first-tenant acceptance' })
    if (response.status !== 200) throw Error(`Catalog ${action} failed: HTTP ${response.status}`)
  }
  // Bundles and quotes resolve applications through the commercial release of this catalog; creation is idempotent.
  const release = await post('/v1/commercial/catalog/releases', { catalog_version: version, reason: 'Isolated commercial acceptance fixture' })
  if (![200, 201].includes(release.status) || release.body?.version !== version) throw Error(`Catalog release failed: HTTP ${release.status}`)
  console.log('Isolated vendor membership, published catalog and commercial release ready')
} finally { await pool.end() }
