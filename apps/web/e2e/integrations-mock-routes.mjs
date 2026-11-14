// Part of the isolated UI mock stack: the integrations routes of the unified integrations service
// (spec 3.6, `/api/v1/integrations/*`). In-memory providers and connections that follow the server's rules.
//
// Providers: `meta` (keys: access_token, app_secret, app_id; generated verify_token; use inbox.whatsapp), `tiktok`
// (oauth; use inbox.tiktok), `paymob` and `zatca` (external: only a derived status and a link to the owning page).
// Connections: 1 = `meta` connected, used by inbox.whatsapp (so it cannot be disconnected), 2 = `tiktok` in `error`
// (reconnect it), no other. `external:paymob` is `not_configured`, `external:zatca` is `connected`.
//
// Magic values:
//   - a secret value containing "reject" is refused by the provider: 422 `integration_rejected` (create, secret
//     replacement, and a re-check of a connection that holds such a secret);
//   - an account id containing "bad" or a blank one: 422 `invalid` on `external_id`; an account id already connected
//     for the provider: 422 `invalid` on `external_id`;
//   - an unknown secret name: 422 `invalid` on `secrets.<name>`;
//   - DELETE of a connection an application uses (connection 1): 409 `in_use`, the message names the uses;
//   - rotation works for `verify_token` of a `keys` connection only: the value is `vt_<n>`, shown once by the page;
//   - OAuth: POST `.../oauth/tiktok/start` answers an https address of a mock provider whose redirect_uri is the real
//     callback path. The browser cannot reach that https address on this stack, so a verifier opens the callback
//     itself: GET `/api/v1/integrations/oauth/tiktok/callback?code=ok` connects tiktok (connection 2 becomes
//     `connected`) and redirects (302) to `/settings/integrations?provider=tiktok&result=connected`; `code=deny`
//     redirects to `...&error=denied`; `code=state` to `...&error=invalid_state`; `code=other` to `...&error=whatever`.
//   - POST `/api/v1/__mock/reset-integrations` restores the initial data.
// Capabilities: `integrations.read` for the reads, `integrations.manage` for every write. The cookie `mock_caps=reader`
// drops `integrations.manage`, so a reader sees the page without its actions.
import { capabilitiesForRequest } from './mock-capabilities.mjs'

export const INTEGRATIONS_READ = 'integrations.read'
export const INTEGRATIONS_MANAGE = 'integrations.manage'

const PREFIX = '/api/v1/integrations'
const RESET_PATH = '/api/v1/__mock/reset-integrations'
const NOW = '2026-11-14T08:00:00Z'
const MAX_VALUE_LENGTH = 4096

const PROVIDERS = [
  { code: 'meta', auth: 'keys', secrets: ['access_token', 'app_secret'], generated_secrets: ['verify_token'], attributes: ['app_id'], uses: [{ key: 'inbox.whatsapp', owner: 'liwan_inbox' }], settings_path: null, webhook: { use: 'inbox.whatsapp', path: '/api/v1/inbox/hooks/whatsapp' } },
  { code: 'tiktok', auth: 'oauth', secrets: [], generated_secrets: [], attributes: [], uses: [{ key: 'inbox.tiktok', owner: 'liwan_inbox' }], settings_path: null },
  { code: 'paymob', auth: 'external', secrets: [], generated_secrets: [], attributes: [], uses: [], settings_path: '/settings/apps/payments#providers' },
  { code: 'zatca', auth: 'external', secrets: [], generated_secrets: [], attributes: [], uses: [], settings_path: '/settings/apps/finance#zatca' },
]
const EXTERNAL_STATUS = {
  paymob: { state: 'not_configured', status_message: '', last_checked: null },
  zatca: { state: 'connected', status_message: '', last_checked: NOW },
}

const fresh = () => ({
  nextId: 3,
  rotations: 0,
  connections: [
    {
      id: 1, provider: 'meta', external_id: '1029384756', label: 'متجر الورد', app_id: '555', state: 'connected', status_message: '',
      last_checked: NOW, token_expires_at: null, secrets: { access_token: 'tok-1', app_secret: 'sec-1', verify_token: 'vt_0' }, used_by: ['inbox.whatsapp'],
    },
    {
      id: 2, provider: 'tiktok', external_id: 'open-id-77', label: 'liwan.shop', app_id: null, state: 'error', status_message: 'انتهت صلاحية الربط. أعد الربط.',
      last_checked: NOW, token_expires_at: '2026-11-13T08:00:00Z', secrets: { access_token: 'tt-1', refresh_token: 'tt-2' }, used_by: ['inbox.tiktok'],
    },
  ],
})
let state = fresh()

const providerOf = code => PROVIDERS.find(provider => provider.code === code)
const refusal = (status, code, message, field) => ({ status, body: { code, message, ...(field ? { field } : {}) } })
const notFound = () => refusal(404, 'not_found', 'not found')
const findConnection = id => state.connections.find(connection => connection.id === id)

function dumpProvider(provider) {
  return { code: provider.code, auth: provider.auth, secrets: provider.secrets, generated_secrets: provider.generated_secrets, attributes: provider.attributes, uses: provider.uses, settings_path: provider.settings_path }
}

function dumpConnection(connection, origin) {
  const provider = providerOf(connection.provider)
  const webhook = provider.webhook && connection.used_by.includes(provider.webhook.use)
    ? [{ use: provider.webhook.use, url: `${origin}${provider.webhook.path}` }]
    : []
  return {
    ref: `connection:${connection.id}`,
    id: connection.id,
    provider: connection.provider,
    auth: provider.auth,
    external_id: connection.external_id,
    label: connection.label,
    app_id: connection.app_id,
    state: connection.state,
    status_message: connection.status_message,
    last_checked: connection.last_checked,
    token_expires_at: connection.token_expires_at,
    secrets: Object.keys(connection.secrets).map(name => ({ name, present: Boolean(connection.secrets[name]) })),
    used_by: connection.used_by,
    webhooks: webhook,
    settings_path: null,
  }
}

function dumpExternal(provider) {
  return {
    ref: `external:${provider.code}`, id: null, provider: provider.code, auth: 'external', external_id: null, label: '', app_id: null,
    ...EXTERNAL_STATUS[provider.code], token_expires_at: null, secrets: [], used_by: [], webhooks: [], settings_path: provider.settings_path,
  }
}

function listConnections(origin) {
  const items = [...state.connections.map(connection => dumpConnection(connection, origin)), ...PROVIDERS.filter(provider => provider.auth === 'external').map(dumpExternal)]
  return { status: 200, body: { items, total: items.length } }
}

/** The typed secrets of a body, or a refusal naming the first bad one. */
function parseSecrets(provider, secrets) {
  if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets) || !Object.keys(secrets).length) return { failure: refusal(422, 'invalid', 'secrets must be a non-empty object', 'secrets') }
  for (const [name, value] of Object.entries(secrets)) {
    if (!provider.secrets.includes(name)) return { failure: refusal(422, 'invalid', `secret ${name} is not accepted`, `secrets.${name}`) }
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_VALUE_LENGTH) return { failure: refusal(422, 'invalid', 'a secret is a non-empty text', `secrets.${name}`) }
    if (value.includes('reject')) return { failure: refusal(422, 'integration_rejected', 'the provider refused the keys', `secrets.${name}`) }
  }
  return { values: Object.fromEntries(Object.entries(secrets).map(([name, value]) => [name, value.trim()])) }
}

function create(body, origin) {
  const provider = typeof body.provider === 'string' ? providerOf(body.provider) : undefined
  if (!provider || provider.auth !== 'keys') return refusal(422, 'invalid', 'provider takes no keys here', 'provider')
  const externalId = typeof body.external_id === 'string' ? body.external_id.trim() : ''
  if (!externalId || externalId.includes('bad')) return refusal(422, 'invalid', 'the account id is not valid', 'external_id')
  if (state.connections.some(connection => connection.provider === provider.code && connection.external_id === externalId)) return refusal(422, 'invalid', 'this account is already connected', 'external_id')
  const unknown = Object.keys(body).find(field => !['provider', 'external_id', 'label', 'app_id', 'secrets'].includes(field))
  if (unknown) return refusal(422, 'invalid', `field ${unknown} is not writable`, unknown)
  const parsed = parseSecrets(provider, body.secrets)
  if (parsed.failure) return parsed.failure
  const missing = provider.secrets.find(name => !parsed.values[name])
  if (missing) return refusal(422, 'invalid', 'enter every secret', `secrets.${missing}`)
  const connection = {
    id: state.nextId, provider: provider.code, external_id: externalId, label: typeof body.label === 'string' ? body.label.trim() : '',
    app_id: typeof body.app_id === 'string' && body.app_id.trim() ? body.app_id.trim() : null, state: 'connected', status_message: '', last_checked: NOW, token_expires_at: null,
    secrets: { ...parsed.values, ...Object.fromEntries(provider.generated_secrets.map(name => [name, `vt_${state.nextId}`])) }, used_by: [],
  }
  state.nextId += 1
  state.connections.push(connection)
  return { status: 201, body: dumpConnection(connection, origin) }
}

function holdsRejectedSecret(connection) {
  return Object.values(connection.secrets).some(value => typeof value === 'string' && value.includes('reject'))
}

/** The provider probe of a stored connection: connected, unless a secret it holds is one the provider refuses. */
function probe(connection) {
  if (connection.provider === 'tiktok' && connection.state === 'error') return { ...connection, last_checked: NOW }
  if (holdsRejectedSecret(connection)) return { ...connection, state: 'error', status_message: 'رفض المزوّد المفاتيح.', last_checked: NOW }
  return { ...connection, state: 'connected', status_message: '', last_checked: NOW }
}

function replaceConnection(next) {
  state = { ...state, connections: state.connections.map(connection => (connection.id === next.id ? next : connection)) }
  return next
}

function update(connection, body, origin) {
  const unknown = Object.keys(body).find(field => !['label', 'app_id', 'secrets', 'state'].includes(field))
  if (unknown) return refusal(422, 'invalid', `field ${unknown} is not writable`, unknown)
  if (!Object.keys(body).length) return refusal(422, 'invalid', 'nothing to change')
  const provider = providerOf(connection.provider)
  let next = { ...connection, secrets: { ...connection.secrets } }
  if ('label' in body) next.label = typeof body.label === 'string' ? body.label.trim() : next.label
  if ('app_id' in body) {
    if (typeof body.app_id !== 'string' || !body.app_id.trim() || !provider.attributes.includes('app_id')) return refusal(422, 'invalid', 'app_id is not valid', 'app_id')
    next.app_id = body.app_id.trim()
  }
  if ('secrets' in body) {
    const parsed = parseSecrets(provider, body.secrets)
    if (parsed.failure) return parsed.failure
    Object.assign(next.secrets, parsed.values)
  }
  if ('state' in body) {
    if (body.state === 'disabled') next = { ...next, state: 'disabled', status_message: '' }
    else if (body.state === 'pending') next = probe(next)
    else return refusal(422, 'invalid', 'state must be disabled or pending', 'state')
  }
  return { status: 200, body: dumpConnection(replaceConnection(next), origin) }
}

function rotate(connection, name) {
  const provider = providerOf(connection.provider)
  if (provider.auth !== 'keys' || !provider.generated.includes(name)) return refusal(422, 'invalid', `secret ${name} is not generated`, 'name')
  state.rotations += 1
  const value = `vt_${state.rotations}`
  replaceConnection({ ...connection, secrets: { ...connection.secrets, [name]: value } })
  return { status: 200, body: { name, value } }
}

function remove(connection) {
  if (connection.used_by.length) return refusal(409, 'in_use', `Used by: ${connection.used_by.join(', ')}`)
  state = { ...state, connections: state.connections.filter(candidate => candidate.id !== connection.id) }
  return { status: 200, body: {} }
}

function startOAuth(provider, body, origin) {
  if (!provider || provider.auth !== 'oauth') return notFound()
  const useKeys = provider.uses.map(use => use.key)
  if (!Array.isArray(body.uses) || !body.uses.length || body.uses.some(use => !useKeys.includes(use))) return refusal(422, 'invalid', 'uses must name uses of the provider', 'uses')
  const redirect = encodeURIComponent(`${origin}${PREFIX}/oauth/${provider.code}/callback`)
  return { status: 200, body: { authorize_url: `https://mock-oauth.example.com/${provider.code}/authorize?redirect_uri=${redirect}&code=ok` } }
}

/** The callback the provider returns to: connect (or re-authorize) tiktok and redirect to the page. */
function finishOAuth(code) {
  const reasons = { deny: 'denied', state: 'invalid_state', other: 'whatever' }
  if (reasons[code]) return `/settings/integrations?provider=tiktok&error=${reasons[code]}`
  const existing = state.connections.find(connection => connection.provider === 'tiktok')
  const connected = { state: 'connected', status_message: '', last_checked: NOW, token_expires_at: '2026-11-15T08:00:00Z' }
  if (existing) replaceConnection({ ...existing, ...connected })
  else {
    state.connections.push({ id: state.nextId, provider: 'tiktok', external_id: `open-id-${state.nextId}`, label: 'liwan.shop', app_id: null, ...connected, secrets: { access_token: 'tt-n', refresh_token: 'tt-r' }, used_by: ['inbox.tiktok'] })
    state.nextId += 1
  }
  return '/settings/integrations?provider=tiktok&result=connected'
}

async function parseBody(req, readBody) {
  try { return JSON.parse(await readBody(req) || '{}') } catch { return {} }
}

export async function handleIntegrations(req, res, path, { json, readBody }) {
  if (path === RESET_PATH && req.method === 'POST') {
    state = fresh()
    json(res, 200, {})
    return true
  }
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false
  const send = result => { json(res, result.status, result.body); return true }
  const capabilities = capabilitiesForRequest(req.headers.cookie, [INTEGRATIONS_READ, INTEGRATIONS_MANAGE])
  const origin = `http://${req.headers.host ?? 'localhost'}`
  const rest = path.slice(PREFIX.length).split('/').filter(Boolean)
  const write = req.method !== 'GET'
  if (!capabilities.includes(write ? INTEGRATIONS_MANAGE : INTEGRATIONS_READ)) return send(refusal(403, 'forbidden', 'forbidden'))

  if (rest[0] === 'providers' && rest.length === 1 && req.method === 'GET') {
    const items = PROVIDERS.map(dumpProvider)
    return send({ status: 200, body: { items, total: items.length } })
  }
  if (rest[0] === 'oauth' && rest.length === 3 && rest[2] === 'start' && req.method === 'POST') return send(startOAuth(providerOf(rest[1]), await parseBody(req, readBody), origin))
  if (rest[0] === 'oauth' && rest.length === 3 && rest[2] === 'callback' && req.method === 'GET') {
    if (rest[1] !== 'tiktok') return send(notFound())
    const code = new URL(req.url, origin).searchParams.get('code') ?? 'ok'
    res.writeHead(302, { location: finishOAuth(code) })
    res.end()
    return true
  }
  if (rest[0] !== 'connections') return false
  if (rest.length === 1) {
    if (req.method === 'GET') return send(listConnections(origin))
    if (req.method === 'POST') return send(create(await parseBody(req, readBody), origin))
    return false
  }
  const connection = /^\d+$/.test(rest[1]) ? findConnection(Number(rest[1])) : undefined
  if (!connection) return send(notFound())
  if (rest.length === 2) {
    if (req.method === 'GET') return send({ status: 200, body: dumpConnection(connection, origin) })
    if (req.method === 'PATCH') return send(update(connection, await parseBody(req, readBody), origin))
    if (req.method === 'DELETE') return send(remove(connection))
    return false
  }
  if (rest.length === 3 && rest[2] === 'test' && req.method === 'POST') return send({ status: 200, body: dumpConnection(replaceConnection(probe(connection)), origin) })
  if (rest.length === 5 && rest[2] === 'secrets' && rest[4] === 'rotate' && req.method === 'POST') return send(rotate(connection, rest[3]))
  return false
}
