/**
 * What an error report may carry out of the product (owner decision 2026-11-18): the error itself and where it happened, never
 * a person's data. Every report is rebuilt from an allow-list, so a field the SDK adds later is dropped until it is listed here.
 * The same function runs in the server SDK, in the browser SDK and again in the browser tunnel (`server/api/error-reports.post.ts`).
 * Pure, so the browser can import it.
 */
import type { ErrorEvent, StackFrame } from '@sentry/browser'
import { withholdSensitive } from './sensitiveValues'

/** The same-origin route that carries browser reports to Sentry, so the CSP `connect-src 'self'` never has to name Sentry. */
export const ERROR_REPORT_PATH = '/api/error-reports'

/**
 * The SDK's own collection switched off (SDK 11 replaced `sendDefaultPii` by `dataCollection`): no user fields, cookies, headers,
 * query strings, bodies, local variables or source lines. `scrubEvent` still rebuilds every event, so this is the first of two layers.
 */
export const SDK_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  stackFrameVariables: false,
  frameContextLines: 0,
}

export type ErrorReportRuntime = 'web-server' | 'web-browser'

export type ErrorReportContext = {
  runtime: ErrorReportRuntime
  release?: string
  environment?: string
  tenant?: string
  userId?: number
}

/** An exception text is a hint to the stack, never a carrier of the data that broke it. */
export const MAX_REPORT_TEXT_LENGTH = 300
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi
const BEARER = /\bBearer\s+\S+/gi
// The same shapes `odoo-addons/liwan_platform/secret_mask.py` masks in Odoo's logs: a secret query value and the catalog image token.
const SECRET_QUERY = /(?<=[?&;])([a-z0-9_.-]*(?:token|signature|hmac|secret|password)|api_?key|key)=[^&\s"']+/gi
const SECRET_CATALOG_PATH = /(\/api\/v1\/public\/inbox\/catalog\/images\/\d+\/)[^/\s"']+/gi

// A path segment that is one long unbroken token (a payment or booking access token) is not part of the route's name.
const TOKEN_SEGMENT = /^[A-Za-z0-9_-]{24,}$/
const TOKEN_SEGMENT_IN_TEXT = /(?<=\/)[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])/g

/** `text` with URL credentials, Bearer tokens, secret query values, path tokens and every covered value withheld, cut to `MAX_REPORT_TEXT_LENGTH`. */
export function scrubReportText(text: string): string {
  const masked = text
    .replace(URL_USERINFO, '$1[redacted]@')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(SECRET_QUERY, '$1=***')
    .replace(SECRET_CATALOG_PATH, '$1***')
    .replace(TOKEN_SEGMENT_IN_TEXT, ':token')
  return withholdSensitive(masked).slice(0, MAX_REPORT_TEXT_LENGTH)
}

const maskTokenSegments = (path: string) => path.split('/').map(segment => (TOKEN_SEGMENT.test(segment) ? ':token' : segment)).join('/')

/** The route of `url` without host, query or fragment, and without access tokens. */
function reportedPath(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return withholdSensitive(maskTokenSegments(new URL(url, 'http://localhost').pathname))
  } catch {
    return undefined
  }
}

/** A frame's script location: an inline script or `eval` reports the page's own address, so it gets the same strip as `request.url`. */
function reportedLocation(location: string | undefined): string | undefined {
  if (!location) return undefined
  const bare = location.split(/[?#]/)[0]!
  try {
    return withholdSensitive(maskTokenSegments(/^[a-z][a-z0-9+.-]*:\/\//i.test(bare) ? new URL(bare).pathname : bare))
  } catch {
    return undefined
  }
}

/** Only the two strings or booleans a field is allowed to carry; anything else from an untrusted envelope is dropped. */
const text = (value: unknown): string | undefined => (typeof value === 'string' ? scrubReportText(value) : undefined)
const flag = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)

function reportedRequest(request: ErrorEvent['request']): ErrorEvent['request'] {
  if (!request) return undefined
  const agent = Object.entries(request.headers ?? {}).find(([name]) => name.toLowerCase() === 'user-agent')?.[1]
  return { method: request.method, url: reportedPath(request.url), headers: agent ? { 'User-Agent': agent } : undefined }
}

const reportedFrame = ({ filename, abs_path, function: name, module, lineno, colno, in_app }: StackFrame): StackFrame =>
  ({ filename: reportedLocation(filename), abs_path: reportedLocation(abs_path), function: name, module, lineno, colno, in_app })

/** `event` reduced to the allow-listed fields, every text of it with the covered values withheld. */
export function scrubEvent(event: ErrorEvent, context: ErrorReportContext): ErrorEvent {
  const tags: Record<string, string> = { runtime: context.runtime }
  if (context.tenant) tags.tenant = context.tenant
  if (context.release) tags.release = context.release
  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    sdk: event.sdk && { name: text(event.sdk.name) ?? '', version: text(event.sdk.version) ?? '' },
    release: context.release,
    environment: context.environment,
    // A log line's arguments and formatted text are free text (names, notes) that no pattern scan can vouch for: only the
    // static template leaves, and a top-level message built from the formatted text goes with them.
    message: event.logentry || event.message === undefined ? undefined : scrubReportText(event.message),
    logentry: event.logentry && { message: event.logentry.message === undefined ? undefined : scrubReportText(event.logentry.message) },
    exception: event.exception && {
      values: event.exception.values?.map(({ type, value, mechanism, stacktrace }) => ({
        type: type === undefined ? undefined : withholdSensitive(type),
        value: value === undefined ? undefined : scrubReportText(value),
        mechanism: mechanism && { type: text(mechanism.type) ?? 'generic', handled: flag(mechanism.handled) },
        stacktrace: stacktrace && { frames: stacktrace.frames?.map(reportedFrame) },
      })),
    },
    // Breadcrumbs keep what happened, never the data an integration attached to it.
    breadcrumbs: event.breadcrumbs?.map(({ type, category, level, message, timestamp }) => ({
      type, category, level, timestamp, message: message === undefined ? undefined : scrubReportText(message),
    })),
    request: reportedRequest(event.request),
    user: context.userId === undefined ? undefined : { id: String(context.userId) },
    tags,
  }
}
