import http from 'node:http'
import { isReleaseAssetRequest, readAsset, validateAssetStore } from '../../apps/web/server/utils/releaseAssets.ts'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { readTenantRegistry } from '../../apps/web/server/utils/tenantRegistry.ts'
import { resolveTenantHost } from '../../apps/web/server/utils/tenantHostResolver.ts'
import { createReleaseLease, readReleaseRoute } from '../../apps/web/server/utils/releaseRouting.ts'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const forbidden = /^(x-odoo-|x-openerp-|x-webvue-|forwarded$|x-forwarded-)/i
// The web's double-submit CSRF token (compared with its cookie, never trusted as identity); Nuxt hop only.
const browserHeaders = new Set(['x-webvue-csrf'])
const selectors = /^(db|database|session_id|sid)$/i
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))
export function sessionCodec(keys, activeKid, now = () => Math.floor(Date.now() / 1000)) {
  if (!keys[activeKid] || Object.values(keys).some(k => typeof k !== 'string' || Buffer.byteLength(k) < 32)) throw Error('invalid_session_keyring')
  const mac = (payload, kid) => createHmac('sha256', keys[kid]).update(payload).digest('base64url')
  return {
    seal(sid, tenant) {
      if (!/^[a-zA-Z0-9_-]{1,256}$/.test(sid)) throw Error('invalid_sid')
      const payload = Buffer.from(JSON.stringify([1, activeKid, tenant.tenantId, tenant.registryRevision, now() + 3600, sid])).toString('base64url')
      return `${payload}.${mac(payload, activeKid)}`
    },
    open(value, tenant) {
      if (typeof value !== 'string' || value.length > 2048 || !/^[\w-]+\.[\w-]+$/.test(value)) throw Error('invalid_session')
      const [payload, sig] = value.split('.')
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
      if (!Array.isArray(data) || data.length !== 6 || data[0] !== 1 || !Object.hasOwn(keys, data[1]) || !equal(sig, mac(payload, data[1])) || data[2] !== tenant.tenantId || data[3] !== tenant.registryRevision || !Number.isSafeInteger(data[4]) || data[4] <= now() || data[4] > now() + 3600 || !/^[a-zA-Z0-9_-]{1,256}$/.test(data[5])) throw Error('invalid_session')
      return data[5]
    },
  }
}
export function requestPlan(req, registry, token, codec) {
  const host = req.headers.host
  const tenant = resolveTenantHost(host, registry.targets)
  const internal = equal(req.headers['x-webvue-proxy-token'], token)
  if (!token || token.length < 32) throw Error('invalid_proxy_token')
  for (const name of Object.keys(req.headers)) {
    if (forbidden.test(name) && !browserHeaders.has(name) && !(internal && ['x-webvue-proxy-token', 'x-webvue-tenant-revision', 'x-webvue-release-pool', 'x-webvue-release-revision', 'x-webvue-release-fence', 'x-webvue-release-admission'].includes(name))) throw Error('forbidden_header')
  }
  if (internal && req.headers['x-webvue-tenant-revision'] !== String(tenant.registryRevision)) throw Error('stale_binding')
  if (!req.url.startsWith('/') || req.url.startsWith('//') || /[\\\r\n]/.test(req.url)) throw Error('invalid_path')
  const url = new URL(req.url, 'http://boundary.invalid')
  for (const key of url.searchParams.keys()) if (selectors.test(key)) throw Error('forbidden_selector')
  if (url.pathname === '/websocket') {
    // Browser-only HTTPS surface: missing/null Origin is not an authenticated exception.
    const origins = (req.rawHeaders ?? []).filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'origin')
    if (origins.length > 1 || req.headers.origin !== `https://${host}`) throw Error('forbidden_origin')
  }
  const favicon = /^\/web\/image\/res\.company\/[1-9][0-9]{0,9}\/logo\/32x32$/.test(url.pathname)
  const avatar = /^\/web\/image\/hr\.employee\/[1-9][0-9]{0,9}\/avatar_128$/.test(url.pathname)
  if (favicon || avatar) {
    // Reject normalized/encoded aliases rather than silently accepting traversal.
    if (req.url.split('?')[0] !== url.pathname || req.url.includes('#') || !['GET', 'HEAD'].includes(req.method ?? 'GET')) throw Error('forbidden_image_route')
    const params = [...url.searchParams]
    if (avatar ? params.length !== 0 : params.length !== 1 || url.searchParams.getAll('v').length !== 1 ||
        !/^(?:0|[0-9]{20})-[a-f0-9]{12}$/.test(url.searchParams.get('v') ?? '')) throw Error('forbidden_image_query')
  }
  const logo = url.pathname === '/web/binary/company_logo'
  if (logo) {
    if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) throw Error('forbidden_route')
    const params = [...url.searchParams]
    if (params.length !== 2 || url.searchParams.getAll('company').length !== 1 || url.searchParams.getAll('v').length !== 1 ||
        !/^[1-9][0-9]{0,9}$/.test(url.searchParams.get('company') ?? '') ||
        !/^(?:0|[0-9]{20})-[a-f0-9]{12}$/.test(url.searchParams.get('v') ?? '')) throw Error('forbidden_logo_query')
  }
  // Company ids are scoped to the resolved database, never interpreted as tenant ids.
  // An explicit route allowlist excludes database manager, generic RPC and vendor console.
  // wkhtmltopdf fetches the stateless QR/barcode image through the public host while it renders a report.
  const barcode = ['GET', 'HEAD'].includes(req.method ?? 'GET') && /^\/report\/barcode\/?$/.test(url.pathname)
  const odoo = favicon || avatar || logo || barcode || url.pathname.startsWith('/api/v1/') || url.pathname === '/websocket' || (internal && ['/web/session/authenticate', '/web/session/destroy'].includes(url.pathname))
  if (!odoo && /^(\/web(?:\/|$)|\/odoo|\/jsonrpc|\/xmlrpc|\/json\/|\/report|\/bus|\/mail|\/discuss|\/website|\/base_setup)/.test(url.pathname)) throw Error('forbidden_route')
  const headers = { ...req.headers }
  for (const key of Object.keys(headers)) if (forbidden.test(key) && (odoo || !browserHeaders.has(key))) delete headers[key]
  delete headers.authorization
  const cookies = (headers.cookie ?? '').split(';').map(v => v.trim()).filter(Boolean)
  const sessions = cookies.filter(v => v.startsWith('session_id='))
  if (sessions.length > 1) throw Error('ambiguous_session')
  let rawSid = null
  let clearSession = false
  if (sessions.length) {
    try { rawSid = codec.open(sessions[0].slice(11), tenant) }
    catch (error) {
      // Recovery never authenticates the rejected identity or bypasses the tenant boundary.
      const method = req.method ?? 'GET'
      const recovery = !internal && !odoo && req.url.split('?')[0] === url.pathname && !req.url.includes('#') && (
        (url.pathname === '/login' && ['GET', 'HEAD'].includes(method)) ||
        (['/api/auth/login', '/api/auth/logout'].includes(url.pathname) && method === 'POST')
      )
      if (!recovery) throw error
      headers.cookie = cookies.filter(value => !value.startsWith('session_id=')).join('; ')
      clearSession = true
    }
  }
  // Keep the signed envelope on the Nuxt hop; unwrap ONLY at the Odoo hop.
  if (odoo) headers.cookie = rawSid ? `session_id=${rawSid}` : ''
  headers.host = odoo ? tenant.database : host
  if (!odoo) {
    headers['x-webvue-proxy-token'] = token
    headers['x-webvue-tenant-revision'] = String(tenant.registryRevision)
  }
  return { tenant, internal, odoo, headers, path: url.pathname + url.search, clearSession }
}
function cookiesForBrowser(cookies, codec, tenant) {
  return (cookies ?? []).map(cookie => {
    const first = cookie.split(';')[0]
    if (!first.startsWith('session_id=')) return null // no unreviewed Odoo cookie scope
    const sid = first.slice(11)
    const deletion = !sid || /max-age=0(?:;|$)/i.test(cookie)
    return `session_id=${deletion ? '' : codec.seal(sid, tenant)}; Path=/; HttpOnly; Secure; SameSite=Lax${deletion ? '; Max-Age=0' : '; Max-Age=3600'}`
  }).filter(Boolean)
}
export function createGuard({ registryPath, proxyToken, keys, activeKid, odooUrl, webUrl, wsUrl = odooUrl, releaseRoutesDir, releaseAssetsDir }) {
  if (releaseAssetsDir !== undefined) {
    if (!releaseRoutesDir) throw Error('release_assets_require_routes')
    validateAssetStore(releaseAssetsDir)
  }
  const codec = sessionCodec(keys, activeKid)
  const upstreams = [odooUrl, webUrl, wsUrl].map(v => new URL(v))
  if (upstreams.some(u => u.protocol !== 'http:' || u.username || u.password)) throw Error('private_http_upstreams_required')
  const plan = req => {
    const registry = readTenantRegistry(registryPath)
    // Stock Odoo's filestore directory is named after its database.
    if (registry.targets.some(t => t.database !== t.filestore)) throw Error('filestore_binding_invalid')
    const p = requestPlan(req, registry, proxyToken, codec)
    if (!releaseRoutesDir) return p
    if (p.internal && p.path === '/_webvue/release-status') return { ...p, status: true }
    const pinHeaders = ['x-webvue-release-pool', 'x-webvue-release-revision', 'x-webvue-release-fence']
    const hasPin = pinHeaders.some(key => req.headers[key] !== undefined)
    const pin = p.internal && hasPin ? { poolId: req.headers[pinHeaders[0]], routeRevision: Number(req.headers[pinHeaders[1]]), fence: Number(req.headers[pinHeaders[2]]) } : undefined
    const lease = createReleaseLease(releaseRoutesDir, p.tenant, pin, 'http', p.internal ? req.headers['x-webvue-release-admission'] : undefined)
    if (!p.odoo) {
      p.headers['x-webvue-release-pool'] = lease.context.poolId
      p.headers['x-webvue-release-revision'] = String(lease.context.routeRevision)
      p.headers['x-webvue-release-fence'] = String(lease.context.fence)
      p.headers['x-webvue-release-admission'] = lease.context.admissionId
    }
    return { ...p, release: lease.context, closeLease: lease.release }
  }
  const server = http.createServer(async (req, res) => {
    let p
    try { p = plan(req) } catch (error) { res.writeHead(error.statusCode === 503 ? 503 : 403); res.end(error.statusCode === 503 ? 'tenant_maintenance_or_release_unavailable' : 'tenant_boundary_rejected'); return }
    if (p.status) {
      try {
        const route = readReleaseRoute(releaseRoutesDir, p.tenant.tenantId, true)
        const directory = join(releaseRoutesDir, 'leases', p.tenant.tenantId)
        const leases = existsSync(directory) ? readdirSync(directory).filter(x => x.endsWith('.json')).map(x => JSON.parse(readFileSync(join(directory, x), 'utf8'))) : []
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ routeRevision: route.routeRevision, fence: route.fence, poolId: route.poolId, releaseId: route.releaseId, maintenance: existsSync(join(releaseRoutesDir, `${p.tenant.tenantId}.maintenance`)), leases: leases.map(x => ({ poolId: x.poolId, operation: x.operation })) }))
      } catch { res.writeHead(503); res.end('release_status_unavailable') }
      return
    }
    if (p.closeLease) { res.once('finish', p.closeLease); res.once('close', p.closeLease) }
    if (releaseAssetsDir !== undefined && (isReleaseAssetRequest(req.url) || isReleaseAssetRequest(p.path))) {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return }
      const asset = readAsset(releaseAssetsDir, req.url)
      if (!asset) { res.writeHead(404, { 'cache-control': 'no-store' }); res.end('release_asset_not_found'); return }
      if (req.headers['if-none-match'] === asset.headers.etag) { res.writeHead(304, asset.headers); res.end(); return }
      res.writeHead(200, asset.headers); res.end(req.method === 'HEAD' ? undefined : asset.body); return
    }
    // Auth DB is injected by our BFF, never accepted from public clients.
    let body
    if ((p.odoo || p.path.startsWith('/api/auth/')) && !['GET', 'HEAD'].includes(req.method)) {
      try {
        const chunks = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 16 * 1024 * 1024) throw Error(); chunks.push(chunk) }
        body = Buffer.concat(chunks)
        if (body.length) {
          if (!String(req.headers['content-type']).startsWith('application/json')) throw Error()
          const json = JSON.parse(body.toString())
          const inspect = (value, path = '') => {
            if (!value || typeof value !== 'object') return
            for (const [key, val] of Object.entries(value)) {
              if (selectors.test(key) && !(p.internal && p.path === '/web/session/authenticate' && path === 'params' && key === 'db' && val === p.tenant.database)) throw Error()
              inspect(val, path ? `${path}.${key}` : key)
            }
          }
          inspect(json)
        }
      } catch { res.writeHead(400); res.end('invalid_upstream_body'); return }
    }
    const target = p.release ? new URL(p.odoo ? p.release.odooUrl : p.release.webUrl) : upstreams[p.odoo ? 0 : 1]
    const upstream = http.request({ hostname: target.hostname, port: target.port, path: p.path, method: req.method, headers: p.headers }, reply => {
      const headers = { ...reply.headers }
      if (p.odoo) headers['set-cookie'] = cookiesForBrowser(headers['set-cookie'], codec, p.tenant)
      if (p.clearSession) {
        headers['cache-control'] = 'no-store'
        // A successful login may already replace the rejected cookie; never delete its replacement.
        if (!(headers['set-cookie'] ?? []).some(cookie => cookie.startsWith('session_id='))) {
          headers['set-cookie'] = [...(headers['set-cookie'] ?? []), 'session_id=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0']
        }
      }
      res.writeHead(reply.statusCode, headers); reply.pipe(res)
    })
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    if (body) upstream.end(body); else req.pipe(upstream)
  })
  server.on('upgrade', (req, socket, head) => {
    let p
    try { p = plan(req); if (!p.odoo || new URL(req.url, 'http://local').pathname !== '/websocket') throw Error() } catch (error) { p?.closeLease?.(); socket.end(`HTTP/1.1 ${error.statusCode === 503 ? '503 Service Unavailable' : '403 Forbidden'}\r\nConnection: close\r\n\r\n`); return }
    if (p.closeLease) socket.once('close', p.closeLease)
    const target = p.release ? new URL(p.release.wsUrl) : upstreams[2]
    const upstream = http.request({ hostname: target.hostname, port: target.port, path: p.path, headers: p.headers })
    upstream.on('upgrade', (reply, remote, remoteHead) => {
      const headers = { ...reply.headers }; headers['set-cookie'] = cookiesForBrowser(headers['set-cookie'], codec, p.tenant)
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers).flatMap(([k,v]) => (Array.isArray(v) ? v : [v]).map(x => `${k}: ${x}\r\n`)).join('')}\r\n`)
      if (remoteHead.length) socket.write(remoteHead)
      if (head.length) remote.write(head)
      remote.pipe(socket); socket.pipe(remote)
      // Bounded open-connection revocation latency: terminate within 30s. Client reconnect rechecks registry.
      const timer = setTimeout(() => { remote.destroy(); socket.destroy() }, 30000)
      socket.on('close', () => { clearTimeout(timer); remote.destroy() })
      remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy())
    })
    upstream.on('response', reply => { socket.end(`HTTP/1.1 ${reply.statusCode} Rejected\r\nConnection: close\r\n\r\n`); reply.resume() })
    upstream.on('error', () => socket.destroy()); upstream.end()
  })
  return server
}
