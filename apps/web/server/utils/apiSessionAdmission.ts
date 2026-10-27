import http from 'node:http'
import https from 'node:https'
import { createHash } from 'node:crypto'
import { createError, getCookie, type H3Event } from 'h3'

// Session IDs are opaque, not proof of authentication. Validate unknown IDs with a
// fixed, body-free identity request in a separate bounded lane. Forged slow uploads
// must never enter the application-work queue. This is admission only: Odoo still
// authenticates and authorizes every forwarded operation, including cached IDs.
const verified = new Map<string, number>()
const pending = new Map<string, { check: Promise<void>, consumers: number }>()
// Sessions the upstream definitively rejected. A forged-cookie flood costs one probe per
// key per window instead of one per request. Unavailable outcomes are never recorded.
const rejected = new Map<string, number>()
const MAX_VERIFIED = 512
const MAX_REJECTED = 128
const TTL_MS = 15_000
const REJECTED_TTL_MS = 5_000
// Both deployed Odoo topologies have two HTTP workers. Keep one available
// for verified application work even while an unknown session probe stalls.
const MAX_CHECKS = 1
// Probes beyond the lane wait in a bounded FIFO queue instead of failing at once, so
// concurrent honest re-validations and a forged-cookie flood cannot starve each other.
const MAX_WAITERS = 32
const WAIT_MS = 2_000
// Requests that may await one shared probe, the first included. Each holds a socket and a
// partially buffered upload, so the coalesced probe window must not retain an unbounded number.
const MAX_CONSUMERS_PER_PROBE = 16
let checking = 0
const laneQueue: Array<() => void> = []
const unavailable = () => createError({ statusCode: 503, data: { code: 'session_validation_unavailable', message: 'Session validation is temporarily unavailable.' } })
const required = () => createError({ statusCode: 403, data: { code: 'session_required', message: 'A valid session is required.' } })
// Odoo answers a suspended tenant's session with this code and ends that session; the browser
// must see the reason, not the generic session_required that every later probe returns.
const suspended = () => createError({ statusCode: 403, data: { code: 'tenant_suspended', message: 'This tenant is suspended.' } })
const busy = () => createError({ statusCode: 429, data: { code: 'session_admission_busy', message: 'Session validation is busy. Try again shortly.' } })

function remember(cache: Map<string, number>, max: number, key: string, ttl: number) {
  if (cache.size >= max) cache.delete(cache.keys().next().value!)
  cache.set(key, Date.now() + ttl)
}

function acquireLane(): Promise<void> {
  if (checking < MAX_CHECKS) { checking++; return Promise.resolve() }
  if (laneQueue.length >= MAX_WAITERS) return Promise.reject(busy())
  return new Promise((resolve, reject) => {
    const resume = () => { clearTimeout(timer); resolve() }
    const timer = setTimeout(() => {
      laneQueue.splice(laneQueue.indexOf(resume), 1)
      reject(busy())
    }, WAIT_MS)
    laneQueue.push(resume)
  })
}

// A released lane passes straight to the next waiter, which keeps `checking` unchanged.
function releaseLane(): void {
  const next = laneQueue.shift()
  if (next) next(); else checking--
}

// Reads a 403 body (bounded) and reports whether Odoo refused the session because the tenant is suspended.
function readSuspension(response: http.IncomingMessage): Promise<boolean> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let bytes = 0
    response.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > 4 * 1024) { response.destroy(); resolve(false) } else chunks.push(Buffer.from(chunk))
    })
    response.on('error', () => resolve(false))
    response.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())?.code === 'tenant_suspended') } catch { resolve(false) }
    })
  })
}

export async function requireApiSession(event: H3Event, upstream: string, binding: Record<string, string>): Promise<void> {
  const session = getCookie(event, 'session_id')?.trim()
  if (!session || session.length > 1024) throw required()
  const identityBinding = Object.fromEntries(Object.entries(binding).filter(([name]) => name !== 'x-webvue-release-admission'))
  const key = createHash('sha256').update(JSON.stringify([upstream, identityBinding, session])).digest('hex')
  if ((verified.get(key) ?? 0) > Date.now()) return
  verified.delete(key)
  if ((rejected.get(key) ?? 0) > Date.now()) throw required()
  rejected.delete(key)
  const existing = pending.get(key)
  if (existing) {
    if (existing.consumers >= MAX_CONSUMERS_PER_PROBE) throw busy()
    existing.consumers++
    try { await existing.check } finally { existing.consumers-- }
    return
  }
  // Registered before waiting for the lane, so identical keys share this one probe and
  // reuse its verified or rejected result instead of probing again.
  const check = (async () => {
    await acquireLane()
    try {
      const target = new URL('/api/v1/me', upstream)
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw required()
      // A coalesced probe has its own short deadline, independent of whichever
      // browser request arrived first. Canceling one consumer must not fail others.
      const valid = await new Promise<boolean | 'unavailable' | 'suspended'>((resolve) => {
        let settled = false
        const finish = (value: boolean | 'unavailable' | 'suspended') => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(value)
        }
        const request = (target.protocol === 'https:' ? https : http).request(target, {
          method: 'GET', agent: false,
          headers: { ...binding, cookie: `session_id=${encodeURIComponent(session)}`, accept: 'application/json' },
        }, response => {
          if (response.statusCode === 403) { readSuspension(response).then(isSuspended => finish(isSuspended ? 'suspended' : false)); return }
          if (response.statusCode !== 200) { response.destroy(); finish(response.statusCode === 401 ? false : 'unavailable'); return }
          let bytes = 0
          const chunks: Buffer[] = []
          response.on('data', chunk => {
            bytes += chunk.length
            if (bytes > 64 * 1024) { response.destroy(); finish('unavailable') } else chunks.push(Buffer.from(chunk))
          })
          response.on('error', () => finish('unavailable'))
          response.on('end', () => {
            try {
              const me = JSON.parse(Buffer.concat(chunks).toString())
              finish(Number.isSafeInteger(me?.id) && me.id > 0 && Number.isSafeInteger(me?.company?.id) && me.company.id > 0)
            } catch { finish('unavailable') }
          })
        })
        const cancel = () => { request.destroy(); finish('unavailable') }
        const timer = setTimeout(cancel, 2000)
        request.on('error', () => finish('unavailable'))
        request.end()
      })
      if (valid === 'unavailable') throw unavailable()
      if (valid !== true) { remember(rejected, MAX_REJECTED, key, REJECTED_TTL_MS); throw valid === 'suspended' ? suspended() : required() }
      remember(verified, MAX_VERIFIED, key, TTL_MS)
    } finally { releaseLane() }
  })()
  const entry = { check, consumers: 1 }
  pending.set(key, entry)
  try { await check } finally { pending.delete(key) }
}
