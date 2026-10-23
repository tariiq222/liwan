/** Dedicated local release edge. No shared cookie envelope or vendor lookup. */
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createReleaseLease, readReleaseRoute, readReleasePools } from '../../apps/web/server/utils/releaseRouting.ts'
import { isReleaseAssetRequest, readAsset, validateAssetStore } from '../../apps/web/server/utils/releaseAssets.ts'

const privateHeader = /^(x-odoo-|x-openerp-|x-webvue-|forwarded$|x-forwarded-)/i
const selectors = /^(db|database|session_id|sid)$/i
const pinNames = ['x-webvue-release-pool', 'x-webvue-release-revision', 'x-webvue-release-fence']
const internalNames = new Set(['x-webvue-proxy-token', 'x-webvue-tenant-revision', ...pinNames, 'x-webvue-release-admission'])
const edgeNames = new Set(['x-webvue-client-ip', 'x-webvue-client-host', 'x-webvue-client-proto'])
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const fail = (statusCode = 403) => Object.assign(Error('dedicated_boundary_rejected'), { statusCode })

export function readLocalBinding(path) {
  const absolute = resolve(path ?? '')
  if (!path || absolute !== path || realpathSync(absolute) !== absolute) throw fail()
  const info = lstatSync(absolute)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw fail()
  const value = JSON.parse(readFileSync(absolute, 'utf8'))
  const fields = ['tenantId', 'database', 'filestore', 'identityRevision', 'host', 'commercialMode']
  if (!value || Object.keys(value).sort().join() !== fields.sort().join()) throw fail()
  if (['tenantId', 'database', 'filestore'].some(key => typeof value[key] !== 'string' || !/^[a-z][a-z0-9_-]{0,62}$/.test(value[key]))) throw fail()
  if (!Number.isSafeInteger(value.identityRevision) || value.identityRevision < 1 || !['saas', 'non_saas'].includes(value.commercialMode)) throw fail()
  if (typeof value.host !== 'string' || value.host.length > 253 || !value.host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw fail()
  return Object.freeze(value)
}

function odooPath(path) {
  return path === '/website/translations' || /^\/(?:web|odoo|base_setup|bus|json|doc|report|mail|discuss)\//.test(path) || /\/static\//.test(path)
}
function cleanHeaders(headers) {
  const result = { ...headers }
  const nominated = String(result.connection ?? '').split(',').map(name => name.trim().toLowerCase()).filter(Boolean)
  for (const name of [...nominated, 'connection', 'proxy-connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'proxy-authenticate', 'proxy-authorization']) delete result[name]
  for (const name of Object.keys(result)) if (privateHeader.test(name)) delete result[name]
  return result
}
function inspectBody(value, binding, internal, auth, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (selectors.test(key) && !(internal && auth && path === 'params' && key === 'db' && item === binding.database)) throw fail()
    inspectBody(item, binding, internal, auth, path ? `${path}.${key}` : key)
  }
}
async function bodyFor(req, binding, internal, path) {
  if (['GET', 'HEAD'].includes(req.method ?? 'GET')) return null
  const parts = []; let length = 0
  for await (const part of req) { length += part.length; if (length > 16 * 1024 * 1024) throw fail(413); parts.push(part) }
  const body = Buffer.concat(parts)
  const content = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  if (body.length && content === 'application/json') {
    let value
    try { value = JSON.parse(body.toString()) } catch { throw fail(400) }
    inspectBody(value, binding, internal, path === '/web/session/authenticate')
    if (path === '/web/session/authenticate' && (!internal || value?.params?.db !== binding.database)) throw fail()
  } else if (body.length && content === 'application/x-www-form-urlencoded') {
    for (const key of new URLSearchParams(body.toString()).keys()) if (selectors.test(key)) throw fail()
  } else if (path === '/web/session/authenticate') throw fail()
  return body
}
function statusEvidence(root, binding) {
  const route = readReleaseRoute(root, binding.tenantId, true)
  if (route.identityRevision !== binding.identityRevision) throw fail(503)
  const directory = join(root, 'leases', binding.tenantId)
  let leases = []
  if (existsSync(directory)) {
    if (realpathSync(directory) !== directory || !lstatSync(directory).isDirectory()) throw fail(503)
    leases = readdirSync(directory).filter(name => name.endsWith('.json')).map(name => {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) throw fail(503)
      const path = join(directory, name), info = lstatSync(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw fail(503)
      const value = JSON.parse(readFileSync(path, 'utf8'))
      if (value.tenantId !== binding.tenantId || typeof value.poolId !== 'string' || typeof value.operation !== 'string') throw fail(503)
      return { poolId: value.poolId, operation: value.operation }
    })
  }
  return { routeRevision: route.routeRevision, fence: route.fence, poolId: route.poolId, releaseId: route.releaseId,
    maintenance: route.state === 'maintenance' || existsSync(join(root, `${binding.tenantId}.maintenance`)), leases }
}

export function createDedicatedGuard({ bindingPath, releaseRoutesDir, proxyToken, trustedEdgeAddresses = ['127.0.0.1', '::1', '::ffff:127.0.0.1'], publicProto = 'https', releaseAssetsDir }) {
  if (typeof proxyToken !== 'string' || Buffer.byteLength(proxyToken) < 32 || !['https', 'http'].includes(publicProto)) throw fail()
  if (!Array.isArray(trustedEdgeAddresses) || !trustedEdgeAddresses.length || trustedEdgeAddresses.some(ip => !isIP(ip))) throw fail()
  if (releaseAssetsDir !== undefined) validateAssetStore(releaseAssetsDir)
  const binding = readLocalBinding(bindingPath)
  // All startup input comes from local files. No upstream/vendor probe here.
  const initial = readReleaseRoute(releaseRoutesDir, binding.tenantId, true)
  if (initial.identityRevision !== binding.identityRevision) throw fail(503)
  readReleasePools(releaseRoutesDir)
  const tenant = { tenantId: binding.tenantId, registryRevision: binding.identityRevision }
  const plan = req => {
    const hostFields = (req.rawHeaders ?? []).filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'host')
    if (hostFields.length !== 1 || req.headers.host !== binding.host) throw fail()
    const internal = equal(req.headers['x-webvue-proxy-token'], proxyToken)
    const peerTrusted = trustedEdgeAddresses.includes(req.socket.remoteAddress)
    for (const name of Object.keys(req.headers)) {
      if (privateHeader.test(name) && name !== 'x-webvue-csrf' && !(internal && internalNames.has(name)) && !((peerTrusted || internal) && edgeNames.has(name))) throw fail()
    }
    if (internal && req.headers['x-webvue-tenant-revision'] !== String(binding.identityRevision)) throw fail()
    const suppliedEdge = [...edgeNames].filter(name => req.headers[name] !== undefined)
    if (suppliedEdge.length && (suppliedEdge.length !== 3 || !(peerTrusted || internal) || !isIP(req.headers['x-webvue-client-ip']) || req.headers['x-webvue-client-host'] !== binding.host || !['http', 'https'].includes(req.headers['x-webvue-client-proto']))) throw fail()
    if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || /[\\\r\n#]/.test(req.url)) throw fail()
    const url = new URL(req.url, 'http://dedicated.invalid')
    if (url.pathname !== req.url.split('?')[0]) throw fail()
    for (const key of url.searchParams.keys()) if (selectors.test(key)) throw fail()
    const status = url.pathname === '/_webvue/release-status'
    if (status && (!internal || req.method !== 'GET')) throw fail()
    const hasPin = pinNames.some(name => req.headers[name] !== undefined)
    if (hasPin && (!internal || !pinNames.every(name => typeof req.headers[name] === 'string'))) throw fail()
    const pin = hasPin ? { poolId: req.headers[pinNames[0]], routeRevision: Number(req.headers[pinNames[1]]), fence: Number(req.headers[pinNames[2]]) } : undefined
    if (pin && (!/^[1-9][0-9]*$/.test(req.headers[pinNames[1]]) || !/^[1-9][0-9]*$/.test(req.headers[pinNames[2]]))) throw fail()
    const path = url.pathname + url.search
    if (status) return { status: true }
    const websocket = url.pathname.startsWith('/websocket')
    if (websocket && !internal && req.headers.origin !== `${publicProto}://${binding.host}`) throw fail()
    const lease = createReleaseLease(releaseRoutesDir, tenant, pin, websocket ? 'ws' : 'http', internal ? req.headers['x-webvue-release-admission'] : undefined)
    // API admission wins even over legacy paths containing /static/.
    const odoo = url.pathname.startsWith('/api/v1/') ? internal : websocket || odooPath(url.pathname)
    const headers = cleanHeaders(req.headers)
    headers.host = binding.host
    headers['x-forwarded-for'] = suppliedEdge.length ? req.headers['x-webvue-client-ip'] : req.socket.remoteAddress
    headers['x-forwarded-host'] = binding.host
    headers['x-forwarded-proto'] = suppliedEdge.length ? req.headers['x-webvue-client-proto'] : publicProto
    if (!odoo) {
      // CSRF is a browser double-submit header, not a private routing selector.
      if (req.headers['x-webvue-csrf'] !== undefined) headers['x-webvue-csrf'] = req.headers['x-webvue-csrf']
      headers['x-webvue-client-ip'] = headers['x-forwarded-for']
      headers['x-webvue-client-host'] = binding.host
      headers['x-webvue-client-proto'] = headers['x-forwarded-proto']
      headers['x-webvue-proxy-token'] = proxyToken
      headers['x-webvue-tenant-revision'] = String(binding.identityRevision)
      headers['x-webvue-release-pool'] = lease.context.poolId
      headers['x-webvue-release-revision'] = String(lease.context.routeRevision)
      headers['x-webvue-release-fence'] = String(lease.context.fence)
      headers['x-webvue-release-admission'] = lease.context.admissionId
    }
    return { internal, odoo, websocket, path, headers, lease }
  }
  const server = http.createServer(async (req, res) => {
    let p
    try { p = plan(req) } catch (error) { res.writeHead(error.statusCode === 503 ? 503 : 403); res.end('dedicated_boundary_rejected'); return }
    if (p.status) {
      try { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(statusEvidence(releaseRoutesDir, binding))) }
      catch { res.writeHead(503); res.end('release_status_unavailable') }
      return
    }
    res.once('finish', p.lease.release); res.once('close', p.lease.release)
    if (releaseAssetsDir !== undefined && (isReleaseAssetRequest(req.url) || isReleaseAssetRequest(p.path))) {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return }
      const asset = readAsset(releaseAssetsDir, req.url)
      if (!asset) { res.writeHead(404, { 'cache-control': 'no-store' }); res.end('release_asset_not_found'); return }
      if (req.headers['if-none-match'] === asset.headers.etag) { res.writeHead(304, asset.headers); res.end(); return }
      res.writeHead(200, asset.headers); res.end(req.method === 'HEAD' ? undefined : asset.body); return
    }
    let body
    // The public API body belongs to Nuxt's session-first, bounded admission.
    // Inspect it only on the authenticated return hop to Odoo.
    try { body = !p.internal && p.path.startsWith('/api/v1/') ? null : await bodyFor(req, binding, p.internal, p.path.split('?')[0]) }
    catch (error) { res.writeHead(error.statusCode ?? 400); res.end('invalid_dedicated_body'); return }
    const target = new URL(p.odoo ? p.lease.context.odooUrl : p.lease.context.webUrl)
    if (body !== null) p.headers['content-length'] = String(body.length)
    const upstream = http.request({ hostname: target.hostname, port: target.port, method: req.method, path: p.path, headers: p.headers }, reply => {
      res.writeHead(reply.statusCode, reply.headers); reply.pipe(res)
    })
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('dedicated_upstream_unavailable') })
    res.once('close', () => upstream.destroy())
    if (body !== null) upstream.end(body); else req.pipe(upstream)
  })
  server.on('upgrade', (req, socket, head) => {
    let p
    try { p = plan(req); if (!p.websocket || String(req.headers.upgrade).toLowerCase() !== 'websocket') throw fail() }
    catch (error) { p?.lease?.release(); socket.end(`HTTP/1.1 ${error.statusCode === 503 ? '503 Service Unavailable' : '403 Forbidden'}\r\nConnection: close\r\n\r\n`); return }
    socket.once('close', p.lease.release)
    const target = new URL(p.lease.context.wsUrl)
    const upstream = http.request({ hostname: target.hostname, port: target.port, method: 'GET', path: p.path,
      headers: { ...p.headers, connection: 'Upgrade', upgrade: 'websocket' } })
    upstream.on('upgrade', (reply, remote, remoteHead) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(reply.headers).flatMap(([key, values]) => (Array.isArray(values) ? values : [values]).map(value => `${key}: ${value}\r\n`)).join('')}\r\n`)
      if (remoteHead.length) socket.write(remoteHead)
      if (head.length) remote.write(head)
      remote.pipe(socket); socket.pipe(remote)
      socket.once('close', () => remote.destroy()); remote.once('close', () => socket.destroy())
      remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy())
    })
    upstream.on('response', reply => { socket.end(`HTTP/1.1 ${reply.statusCode} Rejected\r\nConnection: close\r\n\r\n`); reply.resume() })
    upstream.on('error', () => socket.destroy()); socket.once('close', () => upstream.destroy()); upstream.end()
  })
  return server
}
