import type { H3Event } from 'h3'
import { signServiceRequest } from '@nasq/commercial-contracts/server'
import { bffConfig } from './config'
import { bffFail } from './errors'
import { clientIp } from './client-ip'
import type { AdminSession } from './session-cookie'

const UPSTREAM_TIMEOUT_MS = 10_000

export type ControlRequest = {
  /** Control-plane path including any query, starting with /v1/. */
  path: string
  method: string
  /** A JSON string (signed and sent byte for byte) or an object (serialised once). */
  body?: string | object
  session?: AdminSession
  /** Pre-session routes are signed as the anonymous actor; the session header may still ride along. */
  anonymous?: boolean
}

export type ControlResult = { status: number; data: unknown }

const unavailable = (): never => bffFail(503, 'vendor_unavailable')

function parseJson(text: string): unknown {
  if (!text) return undefined
  try { return JSON.parse(text) } catch { return unavailable() }
}

/**
 * One signed control-plane request. Request headers are built from scratch: no browser header or
 * cookie is forwarded, and x-nasq-client-ip always carries the address this BFF observed.
 * 2xx and 4xx come back as data; anything else (5xx, network, timeout, redirect) is 503.
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
  const headers: Record<string, string> = {
    ...signed,
    accept: 'application/json',
    ...(rawBody === undefined ? {} : { 'content-type': 'application/json' }),
    ...(ip ? { 'x-nasq-client-ip': ip } : {}),
    ...(request.session ? { 'x-nasq-session': request.session.value } : {}),
  }
  let response: Response
  try {
    response = await fetch(target, { method, body: rawBody, headers, redirect: 'error', signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
  } catch {
    return unavailable()
  }
  if (response.status < 200 || response.status >= 500) unavailable()
  const text = await response.text()
  if (response.status >= 400) {
    let data: unknown
    try { data = text ? JSON.parse(text) : undefined } catch { data = undefined }
    return { status: response.status, data: data ?? { code: 'vendor_request_failed' } }
  }
  return { status: response.status, data: parseJson(text) }
}
