import { request as httpsRequest } from 'node:https'
import { signServiceRequest } from '@webvue/commercial-contracts/server'
import type { OdooPasswordAdapter } from './invitation-odoo.js'
import { API_EFFECT_TIMEOUT_MS, EFFECT_ACTOR, EFFECT_ISSUER, EFFECT_PATH, isEffectCode } from '../shared/internal-effect-protocol.js'

const MAX_RESPONSE = 65536

/** Calls control-worker's internal admin password endpoint. The password and invitation token travel only in the
 * signed HTTPS body; thrown errors carry a fixed code and never any input or response text. */
export function internalEffectPasswordAdapter(cfg: { url: string; key: string; ca: Buffer; timeoutMs?: number }): Required<OdooPasswordAdapter> {
  const target = new URL(cfg.url)
  return {
    setAdminPassword: input => new Promise<unknown>((resolve, reject) => {
      const body = JSON.stringify({ tenant_id: input.tenant_id, admin_login: input.admin_login, password: input.password, token: input.token })
      let headers: Record<string, string>
      try { headers = signServiceRequest({ method: 'POST', path: EFFECT_PATH, body, actor: EFFECT_ACTOR, issuer: EFFECT_ISSUER, key: cfg.key }) }
      catch { return reject(Error('unavailable')) }
      let settled = false
      const done = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); fn() }
      const req = httpsRequest({
        hostname: target.hostname, port: target.port || 443, path: EFFECT_PATH, method: 'POST', ca: cfg.ca,
        headers: { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      }, res => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_RESPONSE) { done(() => reject(Error('unavailable'))); req.destroy(); return }
          chunks.push(chunk)
        })
        res.on('error', () => done(() => reject(Error('unavailable'))))
        res.on('end', () => done(() => {
          try {
            const message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (res.statusCode === 200 && message && typeof message === 'object' && Object.hasOwn(message, 'result')) return resolve(message.result)
            if (res.statusCode === 422 && message && typeof message === 'object') return reject(Error(isEffectCode(message.code) ? message.code : 'script_failed'))
            // 409 busy is also a known, non-secret outcome.
            if (res.statusCode === 409 && message?.code === 'busy') return reject(Error('busy'))
          } catch { /* fall through: opaque */ }
          reject(Error('unavailable'))
        }))
      })
      const timer = setTimeout(() => { done(() => reject(Error('unavailable'))); req.destroy() }, cfg.timeoutMs ?? API_EFFECT_TIMEOUT_MS)
      req.on('error', () => done(() => reject(Error('unavailable'))))
      req.end(body)
    }),
  }
}
