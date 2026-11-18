/**
 * The browser's way to Sentry. The browser SDK posts its envelopes to this server (`ERROR_REPORT_PATH`), so the CSP keeps
 * `connect-src 'self'` and the Sentry host never reaches the page. Only error events of the configured project pass; each is
 * scrubbed again here, because the browser is not trusted to have done it.
 */
import type { ErrorEvent } from '@sentry/browser'
import { scrubEvent } from '../../../shared/utils/errorReportScrub'
import { parseDsn } from './dsn'
import type { ErrorReportingSettings } from './settings'

export const MAX_ENVELOPE_BYTES = 64 * 1024
const MAX_IN_FLIGHT = 20
const FORWARD_TIMEOUT_MS = 5000

let inFlight = 0

type Envelope = { body: string; url: string }

/** The scrubbed envelope for Sentry, or the status that refuses the request. */
function acceptEnvelope(raw: string, settings: ErrorReportingSettings): Envelope | number {
  const dsn = parseDsn(settings.dsn)
  const [headerLine, ...rest] = raw.split('\n')
  let header: { dsn?: unknown; event_id?: unknown }
  const events: ErrorEvent[] = []
  try {
    header = JSON.parse(headerLine!)
    if (typeof header.dsn !== 'string') return 400
    const sent = parseDsn(header.dsn)
    if (sent.publicKey !== dsn.publicKey || sent.projectId !== dsn.projectId) return 403
    for (let index = 0; index + 1 < rest.length; index += 2) {
      if (JSON.parse(rest[index]!).type !== 'event') continue
      const event = JSON.parse(rest[index + 1]!) as ErrorEvent
      // A transaction or any other typed payload is not an error report.
      if (event.type === undefined) events.push(event)
    }
  } catch {
    return 400
  }
  if (events.length === 0) return 400
  const lines = [JSON.stringify({ event_id: header.event_id, dsn: settings.dsn })]
  for (const event of events) {
    const userId = Number(event.user?.id)
    const scrubbed = scrubEvent(event, {
      runtime: 'web-browser',
      release: settings.release || undefined,
      environment: settings.environment || undefined,
      tenant: settings.tenant || undefined,
      userId: Number.isInteger(userId) ? userId : undefined,
    })
    lines.push(JSON.stringify({ type: 'event' }), JSON.stringify(scrubbed))
  }
  return { body: lines.join('\n'), url: dsn.envelopeUrl }
}

/** Posts without waiting for Sentry, so the page's report returns at once. Never repeats what Sentry answered. */
function forward({ body, url }: Envelope, send: typeof fetch): Promise<void> {
  inFlight += 1
  return send(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-sentry-envelope' }, signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS) })
    .then((response) => { if (!response.ok) console.warn(`[liwan-errors] Sentry refused a browser report (${response.status})`) })
    .catch(() => { console.warn('[liwan-errors] a browser report could not be forwarded') })
    .finally(() => { inFlight -= 1 })
}

export type BrowserReport = { settings: ErrorReportingSettings; secFetchSite?: string; contentLength?: number; body?: Buffer }

/** The status to answer: 204 when the report was handed on, `done` settles when Sentry has answered. */
export function relayBrowserReport(report: BrowserReport, send: typeof fetch = fetch): { status: number; done?: Promise<void> } {
  if (!report.settings.dsn) return { status: 404 }
  if (report.secFetchSite && report.secFetchSite !== 'same-origin') return { status: 403 }
  if ((report.contentLength ?? 0) > MAX_ENVELOPE_BYTES || (report.body?.length ?? 0) > MAX_ENVELOPE_BYTES) return { status: 413 }
  if (!report.body?.length) return { status: 400 }
  const accepted = acceptEnvelope(report.body.toString('utf8'), report.settings)
  if (typeof accepted === 'number') return { status: accepted }
  if (inFlight >= MAX_IN_FLIGHT) return { status: 429 }
  return { status: 204, done: forward(accepted, send) }
}
