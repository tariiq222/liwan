// The TikTok channel logic in this file is derived from Chatwoot's TikTok integration (MIT).
// Copyright (c) 2017-2026 Chatwoot Inc.
//
// The shared-SaaS TikTok relay: TikTok registers one webhook and one OAuth redirect for
// the platform app, and this service forwards each request to the tenant that owns the
// account. It never stores tokens and never inspects message content.
import http from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { readBodyBytes } from '../../apps/web/server/utils/bufferAdmission.mjs'
import { readTenantRegistry } from '../../apps/web/server/utils/tenantRegistry.ts'

export const SIGNATURE_HEADER = 'tiktok-signature'
/** TikTok signs `{timestamp}.{raw body}`; a delivery older than five seconds is a replay. */
export const SIGNATURE_MAX_AGE_SECONDS = 5
export const BINDINGS_SCHEMA_VERSION = 1

const WEBHOOK_ROUTE = '/tiktok/webhook'
const OAUTH_ROUTE = '/tiktok/oauth/callback'
const TENANT_WEBHOOK_PATH = '/api/v1/inbox/hooks/tiktok'
const TENANT_CALLBACK_PATH = '/api/v1/inbox/tiktok/callback'
const MAX_WEBHOOK_BYTES = 1024 * 1024
const MAX_STATE_LENGTH = 2048
const FORWARD_TIMEOUT_MS = 10_000
const SIGNATURE_PATTERN = /^t=(\d{1,12}),s=([0-9a-f]{64})$/
const HEX_DIGEST_PATTERN = /^[0-9a-f]{64}$/
const STATE_PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/
/** The tenant callback owns the translated error page; this one never echoes the request. */
const REJECTED_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TikTok connection</title></head><body><p>This link is invalid or has expired. Return to the app and try connecting again.</p></body></html>'

const hmac = (secret, ...parts) => {
  const digest = createHmac('sha256', secret)
  for (const part of parts) digest.update(part)
  return digest.digest()
}
const equal = (expected, actual) => expected.length === actual.length && timingSafeEqual(expected, actual)

/** `Tiktok-Signature: t=<unix s>,s=<hex>`, where `s == HMAC_SHA256(client_secret, f"{t}.{raw}")`.
 * The window is the plan's contract and mirrors the tenant: refuse when `now - t > 5`.
 * A future timestamp is not a replay risk because `t` is covered by the signature. */
export function verifySignature(clientSecret, raw, header, now) {
  if (typeof header !== 'string') return false
  const match = SIGNATURE_PATTERN.exec(header)
  if (!match) return false
  if (now - Number(match[1]) > SIGNATURE_MAX_AGE_SECONDS) return false
  return equal(hmac(clientSecret, `${match[1]}.`, raw), Buffer.from(match[2], 'hex'))
}

/** The OAuth state carries the tenant host (Odoo signs it with the same client secret). The relay
 * proves the signature and that the state names an active registry target; the tenant callback owns
 * the state's expiry and every other field. Shared hosting rewrites the Odoo hop's Host to the
 * tenant database, so the signed request host is either the public host or that database. */
export function decodeStateHost(state, clientSecret) {
  if (typeof state !== 'string' || !state || state.length > MAX_STATE_LENGTH) throw Error('invalid_state')
  const parts = state.split('.')
  if (parts.length !== 2 || !STATE_PAYLOAD_PATTERN.test(parts[0]) || !HEX_DIGEST_PATTERN.test(parts[1])) throw Error('invalid_state')
  if (!equal(hmac(clientSecret, parts[0]), Buffer.from(parts[1], 'hex'))) throw Error('invalid_state')
  let fields
  try { fields = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) } catch { throw Error('invalid_state') }
  if (!fields || typeof fields !== 'object' || typeof fields.h !== 'string' || !fields.h) throw Error('invalid_state')
  return fields.h
}

/** The active registry target the signed state names, by public host or by tenant database. */
export function stateTarget(registry, signedHost) {
  const name = signedHost.toLowerCase()
  const target = registry.targets.find(candidate => candidate.enabled && (candidate.host === name || candidate.database === name))
  if (!target) throw Error('unknown_tenant')
  return target
}

/**
 * `{ schemaVersion, bindings: { <user_openid>: <tenant id> } }`, written atomically by the
 * relay's internal binding routes. A missing file means no account is bound yet.
 */
export function readBindings(path) {
  let text
  try { text = readFileSync(path, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return Object.create(null)
    throw error
  }
  const parsed = JSON.parse(text)
  if (!parsed || parsed.schemaVersion !== BINDINGS_SCHEMA_VERSION || !parsed.bindings || typeof parsed.bindings !== 'object' || Array.isArray(parsed.bindings)) throw Error('tiktok_bindings_invalid')
  const bindings = Object.create(null)
  for (const [openId, tenantId] of Object.entries(parsed.bindings)) {
    if (typeof tenantId !== 'string' || !tenantId) throw Error('tiktok_bindings_invalid')
    bindings[openId] = tenantId
  }
  return bindings
}

function readOpenId(raw) {
  let payload
  try { payload = JSON.parse(raw.toString('utf8')) } catch { throw Error('invalid_payload') }
  if (!payload || typeof payload !== 'object' || typeof payload.user_openid !== 'string' || !payload.user_openid) return null
  return payload.user_openid
}

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' })
  res.end(body)
}

/**
 * Builds the relay server. `tenantOrigin(host)` is the only network address it dials; tests
 * point it at a local tenant, production keeps the tenant's HTTPS origin.
 */
export function createTiktokRelay({ clientSecret, registryPath, bindingsPath, proxyToken, tenantOrigin = host => `https://${host}`, now = () => Math.floor(Date.now() / 1000) }) {
  if (typeof clientSecret !== 'string' || !clientSecret) throw Error('invalid_client_secret')
  if (typeof proxyToken !== 'string' || Buffer.byteLength(proxyToken) < 32) throw Error('invalid_proxy_token')
  if (!registryPath) throw Error('invalid_registry_path')
  if (!bindingsPath) throw Error('invalid_bindings_path')

  const currentRegistry = () => readTenantRegistry(registryPath)
  const activeByTenantId = (registry, tenantId) => registry.targets.find(target => target.tenantId === tenantId && target.enabled) ?? null

  async function webhook(req, res) {
    if (req.method !== 'POST') return send(res, 405, 'method_not_allowed')
    let raw
    try { raw = await readBodyBytes(req, res, MAX_WEBHOOK_BYTES) } catch (error) {
      return send(res, error.statusCode === 413 ? 413 : 502, error.statusCode === 413 ? 'payload_too_large' : 'body_unavailable')
    }
    if (!verifySignature(clientSecret, raw, req.headers[SIGNATURE_HEADER], now())) return send(res, 403, 'invalid_signature')
    let openId
    try { openId = readOpenId(raw) } catch { return send(res, 400, 'invalid_payload') }
    // No routable account: answer 200 so TikTok does not retry an event this relay cannot place.
    if (!openId) return send(res, 200, 'ignored')
    let bindings
    try { bindings = readBindings(bindingsPath) } catch { return send(res, 500, 'bindings_unavailable') }
    const tenantId = Object.hasOwn(bindings, openId) ? bindings[openId] : null
    if (!tenantId) return send(res, 200, 'ignored')
    let target
    try { target = activeByTenantId(currentRegistry(), tenantId) } catch { return send(res, 500, 'registry_unavailable') }
    if (!target) return send(res, 200, 'ignored')
    let reply
    try {
      reply = await fetch(`${tenantOrigin(target.host)}${TENANT_WEBHOOK_PATH}`, {
        method: 'POST',
        // The tenant's edge refuses any inbound X-Liwan-Proxy-Token, and its guard strips the
        // internal headers on the public hop: the signature is this hop's only credential.
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: req.headers[SIGNATURE_HEADER],
        },
        body: raw,
        redirect: 'manual',
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      })
    } catch (error) {
      console.error(`tiktok_relay_forward_failed tenant=${target.tenantId}: ${error.message}`)
      return send(res, 502, 'tenant_unavailable')
    }
    // A 5xx or a redirect is not a settled answer: 502 lets TikTok retry the delivery.
    if (reply.status < 200 || (reply.status >= 300 && reply.status < 400) || reply.status >= 500) return send(res, 502, 'tenant_unavailable')
    send(res, reply.status, await reply.text(), reply.headers.get('content-type') ?? 'text/plain; charset=utf-8')
  }

  async function oauth(req, res) {
    if (req.method !== 'GET') return send(res, 405, 'method_not_allowed')
    const url = new URL(req.url, 'http://relay.invalid')
    let target
    try {
      target = stateTarget(currentRegistry(), decodeStateHost(url.searchParams.get('state'), clientSecret))
    } catch {
      return send(res, 400, REJECTED_PAGE, 'text/html; charset=utf-8')
    }
    // The registry owns the destination, never the query string, and the signed query travels unchanged.
    res.writeHead(302, { location: `https://${target.host}${TENANT_CALLBACK_PATH}${url.search}`, 'cache-control': 'no-store' })
    res.end()
  }

  return http.createServer((req, res) => {
    let path
    try { path = new URL(req.url, 'http://relay.invalid').pathname } catch { return send(res, 400, 'invalid_path') }
    const route = path === WEBHOOK_ROUTE ? webhook : path === OAUTH_ROUTE ? oauth : null
    if (!route) return send(res, 404, 'not_found')
    route(req, res).catch(error => {
      console.error(`tiktok_relay_request_failed: ${error.message}`)
      if (!res.headersSent) send(res, 500, 'relay_error')
      else res.end()
    })
  })
}

function start() {
  const port = Number(process.env.LIWAN_TIKTOK_RELAY_PORT ?? 8090)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('invalid_relay_port')
  if (Buffer.byteLength(process.env.LIWAN_SHARED_PROXY_TOKEN ?? '') < 32) throw Error('invalid_proxy_token')
  const server = createTiktokRelay({
    clientSecret: process.env.LIWAN_TIKTOK_CLIENT_SECRET,
    registryPath: process.env.LIWAN_TENANT_REGISTRY_PATH,
    bindingsPath: process.env.LIWAN_TIKTOK_BINDINGS_PATH,
    proxyToken: process.env.LIWAN_SHARED_PROXY_TOKEN,
  })
  // Fail at start, not on the first delivery: an unreadable registry or bindings file is misconfiguration.
  readTenantRegistry(process.env.LIWAN_TENANT_REGISTRY_PATH)
  readBindings(process.env.LIWAN_TIKTOK_BINDINGS_PATH)
  server.listen(port, '0.0.0.0')
  process.once('SIGTERM', () => { server.close() })
  process.once('SIGINT', () => { server.close() })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start()
