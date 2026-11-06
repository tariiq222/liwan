import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { addressAllowed, systemResolver, type EndpointPolicy, type Resolver } from './endpoint.js'
import type { Fetcher } from './client.js'

export const MAX_RESPONSE_BYTES = 1024 * 1024

/** Thrown for a connection the policy forbids (`EndpointRefused`) and for a reply larger than the cap (`BodyTooLarge`); client.ts maps the names to stable codes. */
export class GuardError extends Error {
  constructor(name: 'EndpointRefused' | 'BodyTooLarge') {
    super(name)
    this.name = name
  }
}

/**
 * The only way the control plane reaches a provider. The address of every connection is chosen by the resolver passed to
 * the socket here, checked against the policy at connect time, and then used: nothing between the check and the connect
 * can swap it (DNS rebinding), and a name with several answers is refused if any one of them is forbidden. IP literals,
 * which skip name resolution, are checked before the request. Redirects are not followed, and the reply is read into
 * memory up to `maxBytes`, so no caller ever reads an unbounded body.
 */
export function guardedFetcher(policy: EndpointPolicy, options: { resolve?: Resolver, maxBytes?: number } = {}): Fetcher {
  const resolve = options.resolve ?? systemResolver
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES
  const lookup = (hostname: string, lookupOptions: { all?: boolean }, callback: (error: Error | null, address?: unknown, family?: number) => void): void => {
    resolve(hostname).then((addresses) => {
      if (addresses.some(address => !addressAllowed(address, policy))) return callback(new GuardError('EndpointRefused'))
      if (!addresses.length) return callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))
      const entries = addresses.map(address => ({ address, family: isIP(address) }))
      return lookupOptions?.all ? callback(null, entries) : callback(null, entries[0]!.address, entries[0]!.family)
    }, (error: Error) => callback(error))
  }
  return (url, init) => new Promise<Response>((done, fail) => {
    const target = new URL(url)
    const literal = target.hostname.replace(/^\[|\]$/g, '')
    if (isIP(literal) && !addressAllowed(literal, policy)) return fail(new GuardError('EndpointRefused'))
    const request = (target.protocol === 'https:' ? https : http).request(target, {
      method: init.method, headers: init.headers as Record<string, string>, agent: false, signal: init.signal ?? undefined, lookup: lookup as never,
    }, (reply) => {
      const chunks: Buffer[] = []
      let size = 0
      let settled = false
      const settle = (action: () => void) => { if (!settled) { settled = true; action() } }
      reply.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBytes) return settle(() => { request.destroy(); fail(new GuardError('BodyTooLarge')) })
        chunks.push(chunk)
      })
      reply.on('error', error => settle(() => fail(error)))
      reply.on('close', () => settle(() => fail(new Error('reply_closed'))))
      reply.on('end', () => settle(() => {
        const headers = new Headers()
        for (const [name, value] of Object.entries(reply.headers)) for (const item of [value ?? []].flat()) headers.append(name, item)
        const status = reply.statusCode ?? 502
        done(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers }))
      }))
    })
    request.on('error', fail)
    request.end(typeof init.body === 'string' ? init.body : undefined)
  })
}
