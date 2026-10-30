import { createServer as createHttpsServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'
import { EFFECT_ISSUER, EFFECT_PATH, MAX_EFFECT_BODY, effectRequestSchema, isEffectCode, type EffectRequest } from './internal-effect-protocol.js'

export type InternalEffectDeps = {
  key: string
  /** Records the nonce durably; false when it was already seen. */
  claimNonce: (issuer: string, nonce: string) => Promise<boolean>
  run: (input: EffectRequest, signal: AbortSignal) => Promise<unknown>
  /** Tenant ids with an effect currently running (one at a time per tenant). */
  inFlight: Set<string>
}

const respond = (res: ServerResponse, status: number, data: unknown) => {
  if (res.headersSent || res.writableEnded) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(data))
}

/** Reads at most MAX_EFFECT_BODY bytes; null when the cap is exceeded (the rest is dropped unread). */
async function readCapped(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_EFFECT_BODY) return null
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** POST EFFECT_PATH only. Order: size cap, signature+issuer, replay, schema, per-tenant lock, run.
 * The body (password, token) is never logged; only a fixed outcome code is. A malformed body after a valid
 * signature answers 400 {code:'invalid'}: that caller is the trusted API, so it signals a client bug, not a user error. */
export async function handleInternalEffect(req: IncomingMessage, res: ServerResponse, deps: InternalEffectDeps): Promise<void> {
  if (req.method !== 'POST' || req.url !== EFFECT_PATH) return respond(res, 404, { code: 'not_found' })
  const declared = Number(req.headers['content-length'] ?? '0')
  if (declared > MAX_EFFECT_BODY) { res.setHeader('connection', 'close'); return respond(res, 413, { code: 'too_large' }) }
  const raw = await readCapped(req)
  if (raw === null) { res.setHeader('connection', 'close'); return respond(res, 413, { code: 'too_large' }) }
  const signed = verifyServiceRequest({ method: 'POST', path: EFFECT_PATH, body: raw, key: deps.key, headers: req.headers })
  if (!signed || signed.issuer !== EFFECT_ISSUER) return respond(res, 401, { code: 'unauthorized' })
  if (!await deps.claimNonce(signed.issuer, signed.nonce)) return respond(res, 401, { code: 'unauthorized' })
  let input: EffectRequest
  try {
    const parsed = effectRequestSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return respond(res, 400, { code: 'invalid' })
    input = parsed.data
  } catch { return respond(res, 400, { code: 'invalid' }) }
  if (deps.inFlight.has(input.tenant_id)) return respond(res, 409, { code: 'busy' })
  deps.inFlight.add(input.tenant_id)
  const abort = new AbortController()
  // The caller going away must not leave the child running for a response nobody reads.
  const onClose = () => { if (!res.writableEnded) abort.abort() }
  res.once('close', onClose)
  try {
    const result = await deps.run(input, abort.signal)
    respond(res, 200, { result })
  } catch (e) {
    const code = e instanceof Error && isEffectCode(e.message) ? e.message : 'script_failed'
    console.error('internal_effect', code)
    respond(res, 422, { code })
  } finally {
    deps.inFlight.delete(input.tenant_id)
    res.off('close', onClose)
  }
}

/** Never throws: a bad certificate or an unbindable address logs one reason code and leaves the caller (the job runner) running. */
export function startInternalEffectServer(cfg: { host: string; port: number; tls: { key: Buffer; cert: Buffer } }, deps: InternalEffectDeps, signal: AbortSignal): Server | null {
  let server: Server
  try {
    server = createHttpsServer(cfg.tls, (req, res) => {
      handleInternalEffect(req, res, deps).catch(() => { console.error('internal_effect', 'unavailable'); respond(res, 503, { code: 'unavailable' }) })
    })
    // Covers the 200 s effect plus request transfer; the default 5 min would also do, but make it explicit.
    server.requestTimeout = 230000
    server.on('error', () => { console.error('internal_effect_unavailable', 'listen_failed') })
    server.once('listening', () => { console.log('internal_effect_listening', `${cfg.host}:${cfg.port}`) })
    server.listen(cfg.port, cfg.host)
  } catch {
    console.error('internal_effect_unavailable', 'start_failed')
    return null
  }
  signal.addEventListener('abort', () => server.close(), { once: true })
  return server
}
