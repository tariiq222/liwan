import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import https from 'node:https'
import { createServer } from 'node:net'

export function validatePorts(ports) {
  if (ports.length !== 4 || new Set(ports).size !== 4 || ports.some(port => !Number.isInteger(port) || port < 1024 || port > 65535 || [3000, 3100, 3103, 5432, 8069, 8072, 8080].includes(port))) throw new Error('four distinct non-development ports above 1023 are required')
}
export function assertTenantIdentity(tenants, profiles) {
  for (const key of ['id', 'host', 'database', 'filestore']) {
    if (tenants.length !== 2 || tenants.some(tenant => typeof tenant[key] !== 'string' || !tenant[key]) || new Set(tenants.map(tenant => tenant[key])).size !== 2) throw new Error(`tenant ${key} is not independent`)
  }
  tenants.forEach((tenant, index) => {
    if (tenant.database !== tenant.filestore || profiles[index]?.login !== tenant.adminLogin || profiles[index]?.company?.name !== tenant.name) throw new Error('tenant identity differs')
  })
}
export const isBoundaryDenial = response => response.status === 403 && response.text.includes('tenant_boundary_rejected')
export const writePrivate = (path, content) => writeFileSync(path, content, { mode: 0o600, flag: 'wx' })
export async function stopRetainingData(compose) {
  const logs = await compose(['logs', '--no-color', '--tail', '500'])
  const stopped = await compose(['stop', '--timeout', '20'])
  return { ok: logs.ok && stopped.ok }
}
export function cookieHeader(setCookies = []) {
  const cookies = new Map()
  for (const raw of setCookies) {
    const pair = raw.split(';')[0]
    const at = pair.indexOf('=')
    if (at > 0) cookies.set(pair.slice(0, at), pair)
  }
  return [...cookies.values()].join('; ')
}
export async function availablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function waitFor(check, description, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(1000)
  }
  throw new Error(`timeout: ${description}`)
}
export const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 360_000, maxBuffer: 64 * 1024 * 1024, ...options })
  return { ok: result.status === 0, code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.code }
}
// High-port API proof: connect to loopback but send the production tenant Host without
// a port. This does not claim browser routing at that non-standard origin.
export function edgeRequest(host, path, { port, ca, method = 'GET', body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: '127.0.0.1', port, servername: host, path, method, ca, rejectUnauthorized: true, timeout: 15_000,
      headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }))
    })
    request.on('error', reject)
    request.on('timeout', () => request.destroy(new Error('edge timeout')))
    if (body) request.write(body)
    request.end()
  })
}
