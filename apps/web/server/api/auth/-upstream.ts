import { createError, getHeader, type H3Event } from 'h3'
import { authCookiesAreSecure, forwardAuthCookies } from '../../utils/authCookies'
import { authUpstreamHeaders } from '../../utils/authUpstreamHeaders'
import { tenantRequest } from '../../utils/tenantRequest'
import { boundedTenantJson, tenantTransport, withTenantBody, withUpstreamSlot } from '../../utils/tenantTransport'
import { uiLocaleHeaders } from '../../utils/uiLocale'

// A second-step body is a channel name, a 6-digit code and a short device label; 1 KiB is generous for all three.
const MAX_STEP_BODY = 1024

export type AuthStepAnswer = { ok: boolean; status: number; body: unknown }

/** One hop to an Odoo auth route in whichever transport this deployment runs.
 * `scope` is the admission pool: `public` for sign-in material that has no session yet, `session` for a route
 * that acts on the caller's own signed-in account. `build` reads and re-shapes the browser's bounded JSON body
 * (absent for a body-less call). The file name starts with `-`, so Nuxt's ignore prefix keeps this helper out
 * of the route table. */
export async function authStep(
  event: H3Event,
  path: string,
  options: {
    method: 'GET' | 'POST' | 'DELETE'
    scope?: 'public' | 'session'
    build?: (body: Record<string, unknown>) => Record<string, unknown>
  },
): Promise<AuthStepAnswer> {
  return withTenantBody(event, options.scope ?? 'public', async () => {
    const sent = options.build ? options.build(await boundedTenantJson<Record<string, unknown>>(event, MAX_STEP_BODY)) : undefined
    const body = sent === undefined ? undefined : JSON.stringify(sent)
    const config = useRuntimeConfig(event)
    const identityHeaders = authUpstreamHeaders(event, config.authProxyClientIpHeader)
    const headers: Record<string, string> = {
      cookie: getHeader(event, 'cookie') ?? '',
      ...uiLocaleHeaders(event),
      ...identityHeaders,
    }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const bound = Boolean(tenantRequest(event) || process.env.LIWAN_RELEASE_ROUTES_DIR)
    const send: (init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response> = bound
      ? init => tenantTransport(event, config.odooUrl, path, init)
      : init => withUpstreamSlot(signal => fetch(`${config.odooUrl}${path}`, { ...init, signal }), event)
    const upstream = await send({ method: options.method, headers, body })

    forwardAuthCookies(event, upstream.headers, authCookiesAreSecure(event, identityHeaders))

    const text = await upstream.text()
    let answer: unknown = null
    try { answer = text ? JSON.parse(text) : null } catch { answer = null }
    return { ok: upstream.ok, status: upstream.status, body: answer }
  })
}

/** A refusal as the machine code and its details — never Odoo's prose, which is not in the UI's language. */
export function authRefusal(status: number, body: unknown, fallback: string) {
  const answer = body as { code?: unknown; details?: unknown } | null
  const code = typeof answer?.code === 'string' ? answer.code : fallback
  const details = answer?.details
  return createError({
    statusCode: status,
    data: { code, ...(details && typeof details === 'object' ? { details } : {}) },
  })
}
