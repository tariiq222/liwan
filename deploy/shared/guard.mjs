import { isIP } from 'node:net'
import http from 'node:http'
import { createBodyAdmission, destroyUpstreamWhenCallerCloses, readBodyBytes } from '../../apps/web/server/utils/bufferAdmission.mjs'
import { isReleaseAssetRequest, readAsset, validateAssetStore } from '../../apps/web/server/utils/releaseAssets.ts'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { readTenantRegistry } from '../../apps/web/server/utils/tenantRegistry.ts'
import { isRestoreHost, resolveTenantHost } from '../../apps/web/server/utils/tenantHostResolver.ts'
import { createReleaseLease, readReleaseRoute } from '../../apps/web/server/utils/releaseRouting.ts'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyDocumentHeaders } from './securityHeaders.mjs'

const forbidden = /^(x-odoo-|x-openerp-|x-liwan-|forwarded$|x-forwarded-)/i
// The web's double-submit CSRF token (compared with its cookie, never trusted as identity); Nuxt hop only.
const browserHeaders = new Set(['x-liwan-csrf'])
// The UI language the web proxy forwards on its trusted hop; any other value, or any other sender, is refused.
const UI_LOCALE_HEADER = 'x-liwan-ui-locale'
const uiLocale = value => value === 'ar' || value === 'en'
const deviceCookieName = 'liwan_device='
const deviceToken = /^[A-Za-z0-9_-]{20,256}$/
const deviceMaxAge = 30 * 24 * 60 * 60
const selectors = /^(db|database|session_id|sid)$/i
// Match the BFF's fixed public auth budgets before this edge buffers JSON.
// Separate hop pools avoid a public BFF request deadlocking its internal continuation.
const acquireExternalBody = createBodyAdmission('session')
const acquireInternalBody = createBodyAdmission('session')
const publicAuthBodyLimits = { '/api/auth/totp': 1024, '/api/auth/login': 64 * 1024 }
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
/**
 * The prospect origin belongs to no tenant. Only the listed public flows and built assets reach Nuxt.
 * Caddy replaces the signup client address with the socket peer. The guard is on the private network.
 */
const signupApi = /^\/api\/commercial\/signup\/(?:start|verify-sms|send-email|verify-email)$/
const prospectRoutes = [
  [/^\/(?:payment-done|register)\/?$/, ['GET', 'HEAD']],
  [/^\/api\/commercial\/payment-callback$/, ['GET', 'POST']],
  [signupApi, ['POST']],
  [/^\/_nuxt\/[A-Za-z0-9._\-/]+$/, ['GET', 'HEAD']],
  [/^\/(?:fonts\/[A-Za-z0-9-]+\.woff2|favicon\.(?:ico|svg))$/, ['GET', 'HEAD']],
  [/^\/_i18n\/[a-f0-9]{8,64}\/(?:ar|en)\/messages\.json$/, ['GET', 'HEAD']],
]
export function prospectPlan(req, prospectHost, token) {
  if (!prospectHost || req.headers.host?.toLowerCase() !== prospectHost.toLowerCase()) return null
  if (!token || token.length < 32) throw Error('invalid_proxy_token')
  if (!req.url.startsWith('/') || req.url.startsWith('//') || /[\\\r\n]/.test(req.url) || req.url.includes('#')) throw Error('invalid_path')
  const url = new URL(req.url, 'http://boundary.invalid')
  const method = req.method ?? 'GET'
  if (url.pathname.includes('..') || !prospectRoutes.some(([pattern, methods]) => pattern.test(url.pathname) && methods.includes(method))) throw Error('forbidden_route')
  for (const key of url.searchParams.keys()) if (selectors.test(key)) throw Error('forbidden_selector')
  const headers = { ...req.headers }
  for (const key of Object.keys(headers)) if (forbidden.test(key)) delete headers[key]
  if (signupApi.test(url.pathname)) {
    const ip = req.headers['x-liwan-signup-client']
    if (url.search || typeof ip !== 'string' || !isIP(ip)) throw Error('forbidden_route')
    headers['x-liwan-signup-client'] = ip
  }
  delete headers.authorization
  delete headers.cookie
  headers['x-liwan-proxy-token'] = token
  return { tenant: null, internal: false, odoo: false, prospect: true, headers, path: url.pathname + url.search, clearSession: false }
}
/**
 * Restore targets live in their own registry file (`LIWAN_RESTORE_REGISTRY_PATH`, written by the control plane's
 * restore publication) and never in the tenant registry: a restored copy must not be able to claim a tenant's
 * database, filestore or host. The file is consulted only for restore hosts (`r<32 hex>.restore.<domain>`), so a
 * missing, malformed or half-published restore file can deny restore hosts and nothing else.
 * - no path configured, or a host outside the restore namespace: no restore targets;
 * - file absent (and no `.pending` barrier): no restore targets, so the restore host is simply unknown;
 * - anything else (barrier present, unreadable, malformed, a non-restore host, or a host, tenant id, database or
 *   filestore also present in the tenant registry): `restore_registry_unavailable`, denied like any boundary refusal.
 * It is read per request, with no cache, so a republished file is seen by the next request.
 */
function readRestoreTargets(restoreRegistryPath, mainTargets, host) {
  if (!restoreRegistryPath || !isRestoreHost(host)) return []
  try {
    const { targets } = readTenantRegistry(restoreRegistryPath)
    const clashes = target => ['host', 'tenantId', 'database', 'filestore'].some(key => mainTargets.some(main => main[key] === target[key]))
    if (targets.some(target => !isRestoreHost(target.host) || clashes(target))) throw Error('restore_registry_invalid')
    return targets
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw Error('restore_registry_unavailable')
  }
}
/** The tenant registry plus, for a restore host, the restore registry: one resolution over both, globally unique. */
export function readRegistries({ registryPath, restoreRegistryPath }, host) {
  const registry = readTenantRegistry(registryPath)
  // Stock Odoo's filestore directory is named after its database.
  if (registry.targets.some(t => t.database !== t.filestore)) throw Error('filestore_binding_invalid')
  const restoreTargets = readRestoreTargets(restoreRegistryPath, registry.targets, host)
  return {
    registry: restoreTargets.length ? { ...registry, targets: [...registry.targets, ...restoreTargets] } : registry,
    restoreTenantIds: new Set(restoreTargets.map(t => t.tenantId)),
  }
}
export function requestPlan(req, registry, token, codec) {
  const host = req.headers.host
  const tenant = resolveTenantHost(host, registry.targets)
  const internal = equal(req.headers['x-liwan-proxy-token'], token)
  if (!token || token.length < 32) throw Error('invalid_proxy_token')
  for (const name of Object.keys(req.headers)) {
    if (forbidden.test(name) && !browserHeaders.has(name) && !(internal && name === UI_LOCALE_HEADER && uiLocale(req.headers[name])) && !(internal && ['x-liwan-proxy-token', 'x-liwan-tenant-revision', 'x-liwan-release-pool', 'x-liwan-release-revision', 'x-liwan-release-fence', 'x-liwan-release-admission'].includes(name))) throw Error('forbidden_header')
  }
  if (internal && req.headers['x-liwan-tenant-revision'] !== String(tenant.registryRevision)) throw Error('stale_binding')
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
  const odoo = favicon || avatar || logo || barcode || (internal && url.pathname.startsWith('/api/v1/')) || url.pathname === '/websocket' || (internal && ['/web/session/authenticate', '/web/session/destroy'].includes(url.pathname))
  if (!odoo && /^(\/web(?:\/|$)|\/odoo|\/jsonrpc|\/xmlrpc|\/json\/|\/report|\/bus|\/mail|\/discuss|\/website|\/base_setup)/.test(url.pathname)) throw Error('forbidden_route')
  const headers = { ...req.headers }
  for (const key of Object.keys(headers)) if (forbidden.test(key) && (odoo || !browserHeaders.has(key))) delete headers[key]
  delete headers.authorization
  if (internal && uiLocale(req.headers[UI_LOCALE_HEADER])) headers[UI_LOCALE_HEADER] = req.headers[UI_LOCALE_HEADER]
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
      clearSession = true
    }
  }
  const method = req.method ?? 'GET'
  const exact = req.url.split('?')[0] === url.pathname && !req.url.includes('#')
  const devicePath = internal ? '/api/v1/auth/device' : '/api/auth/device'
  const forgetPath = internal ? '/api/v1/me/devices' : devicePath
  const verifyPath = internal ? '/api/v1/auth/verify' : '/api/auth/verify'
  const readDevice = exact && ((method === 'POST' && url.pathname === devicePath)
    || (method === 'DELETE' && url.pathname === forgetPath))
  const writeDevice = exact && method === 'POST' && [devicePath, verifyPath].includes(url.pathname)
  const devices = cookies.filter(value => value.startsWith(deviceCookieName))
  const device = readDevice && devices.length === 1 && deviceToken.test(devices[0].slice(deviceCookieName.length))
    ? devices[0] : null
  // Keep the signed envelope on the Nuxt hop; unwrap ONLY at the Odoo hop.
  if (odoo) {
    headers.cookie = [rawSid && `session_id=${rawSid}`, device].filter(Boolean).join('; ')
  } else if (clearSession || (devices.length && !device)) {
    headers.cookie = cookies.filter(value =>
      !(clearSession && value.startsWith('session_id=')) && (device || !value.startsWith(deviceCookieName))).join('; ')
  }
  headers.host = odoo ? tenant.database : host
  if (!odoo) {
    headers['x-liwan-proxy-token'] = token
    headers['x-liwan-tenant-revision'] = String(tenant.registryRevision)
  }
  return { tenant, internal, odoo, headers, path: url.pathname + url.search, clearSession, writeDevice }
}
function cookiesForBrowser(cookies, codec, tenant, { odoo = true, writeDevice = false } = {}) {
  const deviceCount = (cookies ?? []).filter(cookie => cookie.startsWith(deviceCookieName)).length
  return (cookies ?? []).map(cookie => {
    const first = cookie.split(';')[0]
    if (first.startsWith(deviceCookieName)) {
      if (!writeDevice || deviceCount !== 1) return null
      const token = first.slice(deviceCookieName.length)
      const deletion = !token && /;\s*max-age=0(?:;|$)/i.test(cookie)
      if (!deletion && !deviceToken.test(token)) return null
      return `${first}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${deletion ? 0 : deviceMaxAge}`
    }
    if (!odoo) return cookie
    if (!first.startsWith('session_id=')) return null // no unreviewed Odoo cookie scope
    const sid = first.slice(11)
    const deletion = !sid || /max-age=0(?:;|$)/i.test(cookie)
    return `session_id=${deletion ? '' : codec.seal(sid, tenant)}; Path=/; HttpOnly; Secure; SameSite=Lax${deletion ? '; Max-Age=0' : '; Max-Age=3600'}`
  }).filter(Boolean)
}
// One audit line per refused request: reason code, method, path and tenant host only.
// Header values, cookies, tokens and the query string are never logged; a path segment is kept only as a short lowercase word or a numeric id, any other segment (a token) becomes `*`.
const auditPath = url => String(url ?? '').split('?')[0].split('#')[0].slice(0, 200).split('/').map(s => /^(?:[a-z][a-z0-9_-]{0,31}|\d{1,12})?$/.test(s) ? s : '*').join('/')
function auditRefusal(req, error) {
  if (error.statusCode === 503) return // maintenance or release-unavailable is not a boundary refusal
  const reason = /^[a-z_]{1,64}$/.test(error.message) ? error.message : 'unknown'
  console.error(JSON.stringify({
    event: 'tenant_boundary_rejected',
    reason,
    method: String(req.method ?? 'GET').slice(0, 16),
    path: auditPath(req.url),
    host: String(req.headers?.host ?? '').slice(0, 200)
  }))
}
export function createGuard({ registryPath, restoreRegistryPath = '', proxyToken, prospectHost = '', keys, activeKid, odooUrl, webUrl, wsUrl = odooUrl, restoreOdooUrl = '', restoreWsUrl = restoreOdooUrl, releaseRoutesDir, releaseAssetsDir }) {
  if (releaseAssetsDir !== undefined) {
    if (!releaseRoutesDir) throw Error('release_assets_require_routes')
    validateAssetStore(releaseAssetsDir)
  }
  const codec = sessionCodec(keys, activeKid)
  const upstreams = [odooUrl, webUrl, wsUrl].map(v => new URL(v))
  // Restored databases live in the restore Postgres, so a restore host is served by restore-odoo, never by the tenant Odoo.
  if (restoreRegistryPath && !restoreOdooUrl) throw Error('restore_upstream_required')
  const restoreUpstreams = restoreRegistryPath ? [restoreOdooUrl, webUrl, restoreWsUrl].map(v => new URL(v)) : upstreams
  if ([...upstreams, ...restoreUpstreams].some(u => u.protocol !== 'http:' || u.username || u.password)) throw Error('private_http_upstreams_required')
  const plan = req => {
    const prospect = prospectPlan(req, prospectHost, proxyToken)
    if (prospect) return prospect
    const { registry, restoreTenantIds } = readRegistries({ registryPath, restoreRegistryPath }, req.headers.host)
    const p = requestPlan(req, registry, proxyToken, codec)
    p.restore = restoreTenantIds.has(p.tenant.tenantId)
    // A restore target has no release route; with release routing on it is refused rather than leased.
    if (p.restore && releaseRoutesDir) throw Error('restore_release_routes_unsupported')
    if (!releaseRoutesDir) return p
    if (p.internal && p.path === '/_liwan/release-status') return { ...p, status: true }
    const pinHeaders = ['x-liwan-release-pool', 'x-liwan-release-revision', 'x-liwan-release-fence']
    const hasPin = pinHeaders.some(key => req.headers[key] !== undefined)
    const pin = p.internal && hasPin ? { poolId: req.headers[pinHeaders[0]], routeRevision: Number(req.headers[pinHeaders[1]]), fence: Number(req.headers[pinHeaders[2]]) } : undefined
    const lease = createReleaseLease(releaseRoutesDir, p.tenant, pin, 'http', p.internal ? req.headers['x-liwan-release-admission'] : undefined)
    if (!p.odoo) {
      p.headers['x-liwan-release-pool'] = lease.context.poolId
      p.headers['x-liwan-release-revision'] = String(lease.context.routeRevision)
      p.headers['x-liwan-release-fence'] = String(lease.context.fence)
      p.headers['x-liwan-release-admission'] = lease.context.admissionId
    }
    return { ...p, release: lease.context, closeLease: lease.release }
  }
  const server = http.createServer(async (req, res) => {
    let p
    try { p = plan(req) } catch (error) { auditRefusal(req, error); res.writeHead(error.statusCode === 503 ? 503 : 403); res.end(error.statusCode === 503 ? 'tenant_maintenance_or_release_unavailable' : 'tenant_boundary_rejected'); return }
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
    let releaseBody = () => {}
    // H3/radix accepts one trailing slash on these BFF routes. Bound the same aliases.
    const publicPath = p.path.split('?')[0].replace(/\/$/, '')
    const publicBodyLimit = p.prospect && signupApi.test(publicPath) ? 2048 : !p.internal ? publicAuthBodyLimits[publicPath] : undefined
    if ((p.odoo || publicBodyLimit !== undefined || p.path.startsWith('/api/auth/')) && !['GET', 'HEAD'].includes(req.method)) {
      try {
        releaseBody = await (p.internal ? acquireInternalBody : acquireExternalBody)(req, res)
        body = await readBodyBytes(req, res, publicBodyLimit ?? 16 * 1024 * 1024)
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
      } catch (error) {
        releaseBody()
        if (error.statusCode === 502) {
          if (!res.destroyed) { res.writeHead(502, { 'content-type': 'application/json', connection: 'close' }); res.end(JSON.stringify(error.data)) }
        } else if (publicBodyLimit !== undefined) {
          const oversized = error.statusCode === 413
          res.writeHead(oversized ? 413 : 400, { 'content-type': 'application/json', connection: 'close' })
          res.end(JSON.stringify(oversized ? { code: 'payload_too_large', message: 'The request body exceeds the allowed size.' } : { code: 'invalid_request', message: 'The request body is invalid.' }))
        } else { res.writeHead(400); res.end('invalid_upstream_body') }
        return
      }
    }
    const target = p.release ? new URL(p.odoo ? p.release.odooUrl : p.release.webUrl) : (p.restore ? restoreUpstreams : upstreams)[p.odoo ? 0 : 1]
    const upstream = http.request({ hostname: target.hostname, port: target.port, path: p.path, method: req.method, headers: p.headers }, reply => {
      const headers = { ...reply.headers }
      // A browser document from Nuxt gets the shared edge's security headers; Odoo's JSON,
      // reports and downloads do not, exactly as on the dedicated edge (issue #480).
      if (!p.odoo) applyDocumentHeaders(headers)
      if (headers['set-cookie']) {
        headers['set-cookie'] = cookiesForBrowser(headers['set-cookie'], codec, p.tenant, p)
      }
      if (p.clearSession) {
        headers['cache-control'] = 'no-store'
        // A successful login may already replace the rejected cookie; never delete its replacement.
        if (!(headers['set-cookie'] ?? []).some(cookie => cookie.startsWith('session_id='))) {
          headers['set-cookie'] = [...(headers['set-cookie'] ?? []), 'session_id=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0']
        }
      }
      res.writeHead(reply.statusCode, headers); reply.pipe(res)
    })
    // Keep credit through actual continuation settlement, even when an internal caller closes.
    upstream.once('close', releaseBody)
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    // Nuxt can reject an API upload before its body ends, and a hung target must not pin a body credit.
    destroyUpstreamWhenCallerCloses(res, upstream, p.internal)
    if (body) upstream.end(body); else req.pipe(upstream)
  })
  server.on('upgrade', (req, socket, head) => {
    let p
    try { p = plan(req); if (!p.odoo || new URL(req.url, 'http://local').pathname !== '/websocket') throw Error() } catch (error) { auditRefusal(req, error); p?.closeLease?.(); socket.end(`HTTP/1.1 ${error.statusCode === 503 ? '503 Service Unavailable' : '403 Forbidden'}\r\nConnection: close\r\n\r\n`); return }
    if (p.closeLease) socket.once('close', p.closeLease)
    const target = p.release ? new URL(p.release.wsUrl) : (p.restore ? restoreUpstreams : upstreams)[2]
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
