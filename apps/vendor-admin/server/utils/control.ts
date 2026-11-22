import type { H3Event } from 'h3'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import { bffConfig } from './config'
import { bffFail } from './errors'
import { clientIp } from './client-ip'
import type { AdminSession } from './session-cookie'

export const UPSTREAM_TIMEOUT_MS = 10_000

export type ControlRequest = {
  /** Control-plane path including any query, starting with /v1/. */
  path: string
  method: string
  /** A JSON string (signed and sent byte for byte) or an object (serialised once). */
  body?: string | object
  session?: AdminSession
  /** Pre-session routes are signed as the anonymous actor; the session header may still ride along. */
  anonymous?: boolean
  /** How long the control plane may take, when a route is slower than the default (the AI provider probes, see proxy.ts). */
  timeoutMs?: number
  /** Codes of a 502 body that may reach the browser (only the code, never the rest of the body); every other 5xx stays 503. */
  passThrough502?: readonly string[]
}

export type ControlResult = { status: number; data: unknown }

const unavailable = (): never => bffFail(503, 'vendor_unavailable')

function passedThrough502(text: string, codes: readonly string[]): ControlResult {
  let code: unknown
  try { code = (JSON.parse(text) as { code?: unknown } | null)?.code } catch { return unavailable() }
  return typeof code === 'string' && codes.includes(code) ? { status: 502, data: { code } } : unavailable()
}

function parseJson(text: string): unknown {
  if (!text) return undefined
  try { return JSON.parse(text) } catch { return unavailable() }
}

/**
 * One signed control-plane request. Request headers are built from scratch: no browser header or
 * cookie is forwarded, and x-liwan-client-ip always carries the address this BFF observed.
 * 2xx and 4xx come back as data; anything else (5xx, network, timeout, redirect) is 503, except a 502 whose code the
 * caller listed in `passThrough502`: that one answers with its code alone.
 */
export async function controlCall(event: H3Event, request: ControlRequest): Promise<ControlResult> {
  const config = bffConfig(event)
  const method = request.method.toUpperCase()
  const rawBody = typeof request.body === 'object' ? JSON.stringify(request.body) : request.body
  const target = new URL(request.path, config.controlBase)
  if (!request.anonymous && !request.session) bffFail(401, 'unauthorized')
  const signed = signServiceRequest({
    method,
    path: `${target.pathname}${target.search}`,
    body: rawBody,
    actor: request.anonymous ? 'anonymous' : (request.session as AdminSession).accountId,
    ...(request.anonymous ? { anonymous: true as const } : {}),
    issuer: config.installationId,
    key: config.serviceKey,
  })
  const ip = clientIp(event)
  // The auth routes' attempt limits are scoped by this address: never sign one without it.
  if (request.anonymous && !ip) unavailable()
  const headers: Record<string, string> = {
    ...signed,
    accept: 'application/json',
    ...(rawBody === undefined ? {} : { 'content-type': 'application/json' }),
    ...(ip ? { 'x-liwan-client-ip': ip } : {}),
    ...(request.session ? { 'x-liwan-session': request.session.value } : {}),
  }
  let response: Response
  try {
    response = await fetch(target, { method, body: rawBody, headers, redirect: 'error', signal: AbortSignal.timeout(request.timeoutMs ?? UPSTREAM_TIMEOUT_MS) })
  } catch {
    return unavailable()
  }
  if (response.status === 502 && request.passThrough502) return passedThrough502(await response.text(), request.passThrough502)
  if (response.status < 200 || response.status >= 500) unavailable()
  const text = await response.text()
  if (response.status >= 400) {
    let data: unknown
    try { data = text ? JSON.parse(text) : undefined } catch { data = undefined }
    return { status: response.status, data: data ?? { code: 'vendor_request_failed' } }
  }
  return { status: response.status, data: parseJson(text) }
}
