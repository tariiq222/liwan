// Operator-only fixture setup inside the isolated control-api container.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import https from 'node:https'
import { Pool } from 'pg'
import { signServiceRequest } from '@nasq/commercial-contracts/server'
const actor = Number(process.argv[2])
if (!Number.isSafeInteger(actor) || actor <= 1) throw Error('vendor fixture UID required')
const pool = new Pool({ connectionString: process.env.CONTROL_DATABASE_URL })
try {
  execFileSync('npm', ['-w', 'apps/control-plane', 'run', 'admin', '--', 'grant', String(actor),
    'vendor.read,vendor.tenants.manage,vendor.catalog.manage,vendor.operations.run,vendor.audit.read', 'Isolated local lifecycle fixture'], { stdio: 'pipe' })
  const version = 'lifecycle-3899a095'
  let row = (await pool.query('SELECT id,status FROM catalog_entries WHERE version=$1', [version])).rows[0]
  if (!row) {
    execFileSync('npm', ['-w', 'apps/control-plane', 'run', 'admin', '--', 'catalog-import', version, 'Isolated local lifecycle fixture'], { stdio: 'pipe' })
    row = (await pool.query('SELECT id,status FROM catalog_entries WHERE version=$1', [version])).rows[0]
  }
  for (const action of row.status === 'draft' ? ['validate', 'publish'] : row.status === 'validated' ? ['publish'] : []) {
    const path = `/v1/catalog/${row.id}/${action}`
    const body = JSON.stringify({ reason: 'Isolated local first-tenant acceptance' })
    const headers = signServiceRequest({ method: 'POST', path, body, actor, issuer: process.env.CONTROL_INSTALLATION_ID, key: process.env.CONTROL_SERVICE_KEY })
    const response = await new Promise((resolve, reject) => {
      const req = https.request(`https://control-api:4187${path}`, { method: 'POST', ca: readFileSync(process.env.CONTROL_TLS_CERT), headers: { ...headers, 'content-type': 'application/json' } }, res => {
        let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }))
      }); req.on('error', reject); req.end(body)
    })
    if (response.status !== 200) throw Error(`Catalog ${action} failed: HTTP ${response.status}`)
  }
  console.log('Isolated vendor membership and published catalog ready')
} finally { await pool.end() }
