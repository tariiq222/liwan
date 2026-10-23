import http from 'node:http'
import https from 'node:https'
import { createHash } from 'node:crypto'
import { createError, getCookie, type H3Event } from 'h3'

// Session IDs are opaque, not proof of authentication. Validate unknown IDs with a
// fixed, body-free identity request in a separate bounded lane. Forged slow uploads
// must never enter the application-work queue. This is admission only: Odoo still
// authenticates and authorizes every forwarded operation, including cached IDs.
const verified = new Map<string, number>()
const pending = new Map<string, Promise<void>>()
const MAX_VERIFIED = 512
const TTL_MS = 15_000
const MAX_CHECKS = 2
let checking = 0
const unavailable = () => createError({ statusCode: 503, data: { code: 'session_validation_unavailable' } })
const required = () => createError({ statusCode: 403, data: { code: 'session_required' } })

export async function requireApiSession(event: H3Event, upstream: string, binding: Record<string, string>): Promise<void> {
  const session = getCookie(event, 'session_id')?.trim()
  if (!session || session.length > 1024) throw required()
  const identityBinding = Object.fromEntries(Object.entries(binding).filter(([name]) => name !== 'x-webvue-release-admission'))
  const key = createHash('sha256').update(JSON.stringify([upstream, identityBinding, session])).digest('hex')
  if ((verified.get(key) ?? 0) > Date.now()) return
  verified.delete(key)
  const existing = pending.get(key)
  if (existing) return existing
  if (checking >= MAX_CHECKS) throw createError({ statusCode: 429, data: { code: 'session_admission_busy' } })
  const check = (async () => {
    checking++
    try {
      const target = new URL('/api/v1/me', upstream)
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw required()
      // A coalesced probe has its own short deadline, independent of whichever
      // browser request arrived first. Canceling one consumer must not fail others.
      const valid = await new Promise<boolean | 'unavailable'>((resolve) => {
        let settled = false
        const finish = (value: boolean | 'unavailable') => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(value)
        }
        const request = (target.protocol === 'https:' ? https : http).request(target, {
          method: 'GET', agent: false,
          headers: { ...binding, cookie: `session_id=${encodeURIComponent(session)}`, accept: 'application/json' },
        }, response => {
          if (response.statusCode !== 200) { response.destroy(); finish([401, 403].includes(response.statusCode ?? 0) ? false : 'unavailable'); return }
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
      if (!valid) throw required()
      if (verified.size >= MAX_VERIFIED) verified.delete(verified.keys().next().value!)
      verified.set(key, Date.now() + TTL_MS)
    } finally { checking-- }
  })()
  pending.set(key, check)
  try { await check } finally { pending.delete(key) }
}
