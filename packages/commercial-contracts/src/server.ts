import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export type ServiceSignInput = {
  method: string
  path: string
  body?: string | Uint8Array
  actor: number | string
  issuer: string
  key: string
  timestamp?: number
  nonce?: string
  anonymous?: true
}
type Headers = Record<string, string | string[] | undefined>

function value(headers: Headers, name: string): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(raw) ? undefined : raw
}

function bodyHash(body: string | Uint8Array | undefined): string {
  return createHash('sha256').update(body ?? '').digest('hex')
}

function signature(input: Required<Omit<ServiceSignInput, 'anonymous'>>): string {
  const signed = JSON.stringify([input.method.toUpperCase(), input.path, String(input.actor), input.issuer, String(input.timestamp), input.nonce, bodyHash(input.body)])
  return createHmac('sha256', input.key).update(signed).digest('hex')
}

export function signServiceRequest(input: ServiceSignInput): Record<string, string> {
  if (Buffer.byteLength(input.key) < 32) throw new Error('service key must be at least 32 bytes')
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(input.issuer)) throw new Error('invalid issuer')
  const anonymous = input.anonymous === true
  if (anonymous ? input.actor !== 'anonymous' : !/^[1-9][0-9]*$/.test(String(input.actor))) throw new Error('actor must be a positive account ID')
  if (!input.path.startsWith('/v1/') && input.path !== '/v1') throw new Error('invalid control service path')
  const { anonymous: _anonymous, ...rest } = input
  const full = { ...rest, body: input.body ?? '', timestamp: input.timestamp ?? Math.floor(Date.now() / 1000), nonce: input.nonce ?? randomUUID() }
  return {
    'x-liwan-issuer': full.issuer,
    'x-liwan-actor': String(full.actor),
    'x-liwan-timestamp': String(full.timestamp),
    'x-liwan-nonce': full.nonce,
    'x-liwan-signature': signature(full),
  }
}

export function verifyServiceRequest(input: Omit<ServiceSignInput, 'actor' | 'issuer' | 'timestamp' | 'nonce'> & { headers: Headers; actor?: number | string; issuer?: string; timestamp?: number; nonce?: string; now?: number }): { actor: number | 'anonymous'; issuer: string; nonce: string; timestamp: number } | null {
  if (Buffer.byteLength(input.key) < 32) return null
  const issuer = input.issuer ?? value(input.headers, 'x-liwan-issuer')
  const actorText = String(input.actor ?? value(input.headers, 'x-liwan-actor') ?? '')
  const timestampText = String(input.timestamp ?? value(input.headers, 'x-liwan-timestamp') ?? '')
  const nonce = input.nonce ?? value(input.headers, 'x-liwan-nonce')
  const received = value(input.headers, 'x-liwan-signature')
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const anonymous = input.anonymous === true
  if (!issuer || !/^[a-zA-Z0-9._-]{1,128}$/.test(issuer) || (anonymous ? actorText !== 'anonymous' : !/^[1-9][0-9]*$/.test(actorText)) || !/^\d{10,}$/.test(timestampText) || !nonce || !/^[a-zA-Z0-9._-]{1,128}$/.test(nonce) || !received || !/^[a-f0-9]{64}$/.test(received)) return null
  const actor = anonymous ? 'anonymous' : Number(actorText)
  const timestamp = Number(timestampText)
  if ((!anonymous && !Number.isSafeInteger(actor)) || !Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 30) return null
  const expected = signature({ method: input.method, path: input.path, body: input.body ?? '', actor, issuer, key: input.key, timestamp, nonce })
  if (!timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'))) return null
  return { actor, issuer, nonce, timestamp }
}

export * from './commercial/catalog.js'
export * from './commercial/entitlements.js'
export * from './commercial/quotes.js'
