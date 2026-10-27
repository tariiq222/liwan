import type { ZodType } from 'zod'
import { saveErrorMessage } from '../utils/formFeedback'
import { ApiErrorSchema } from '@webvue/contracts'
import { contentDispositionFilename } from '../utils/contentDisposition'
import { isTenantSuspended, reportTenantSuspension, TENANT_SUSPENDED } from '../utils/tenantSuspension'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

/** Class of refusal by HTTP status, used when the code has no more specific text. */
function statusKey(status: number): string | undefined {
  if (status === 400 || status === 422) return 'invalid'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'notFound'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rateLimited'
  if (status >= 500) return 'unavailable'
  return undefined
}

/** The code a refusal carries when it names one of the generic classes itself. */
const CLASS_BY_CODE: Record<string, string> = {
  invalid: 'invalid',
  forbidden: 'forbidden',
  not_found: 'notFound',
  conflict: 'conflict',
  rate_limited: 'rateLimited',
  unavailable: 'unavailable',
}

/**
 * Odoo translates the validation text it raises (`env._()`), so a server message already written in the
 * UI language is specific and worth showing; an English message under an Arabic UI is a developer text.
 * The script is the only signal the envelope carries, so compare Arabic letters with the UI locale.
 */
function isInUiLanguage(message: string, locale: string): boolean {
  const arabic = /[\u0600-\u06FF]/.test(message)
  return locale === 'ar' ? arabic : !arabic
}

/** A refusal of a file route arrives as a blob: its JSON text is the structured error. */
async function errorBody(data: unknown): Promise<unknown> {
  if (!(data instanceof Blob)) return data
  try { return JSON.parse(await data.text()) } catch { return undefined }
}

/** A Nitro admission refusal arrives in H3's envelope, `{ statusCode, data: { code, message } }`. */
function structuredError(body: unknown) {
  const direct = ApiErrorSchema.safeParse(body)
  if (direct.success || !body || typeof body !== 'object' || !('data' in body)) return direct
  return ApiErrorSchema.safeParse(body.data)
}

export function useApi() {
  const { t, te, locale } = useI18n()
  // Cookie forwarding is only meaningful during SSR: on the client the browser
  // already attaches the session cookie to same-origin requests.
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : {}
  // Only middleware-validated server events may supply private hop identity.
  // This stays in the SSR closure, never in returned data or the client payload.
  const trustedHeaders = import.meta.server && (useRequestEvent()?.context.tenant || useRequestEvent()?.context.webvueRelease)
    ? useRequestHeaders(['host', 'x-webvue-proxy-token', 'x-webvue-tenant-revision',
      'x-webvue-release-pool', 'x-webvue-release-revision', 'x-webvue-release-fence', 'x-webvue-release-admission',
      'x-webvue-client-ip', 'x-webvue-client-host', 'x-webvue-client-proto'])
    : {}

  async function $api<T>(
    path: string,
    opts: { method?: string; body?: unknown; query?: Record<string, unknown>; schema?: ZodType<T>; signal?: AbortSignal; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const writing = !['GET', 'HEAD', 'OPTIONS'].includes((opts.method ?? 'GET').toUpperCase())
    try {
      const data = await $fetch<unknown>(path, {
        method: (opts.method ?? 'GET') as any,
        body: opts.body as any,
        ...(writing ? { retry: 0 } : {}),
        query: opts.query,
        signal: opts.signal,
        // Never forward a cookie or private hop identity to an absolute URL,
        // protocol-relative URL, encoded path or normalized traversal target.
        headers: /^\/api\/v1\/[a-zA-Z0-9_/-]+$/.test(path) && !path.includes('..')
          ? { ...headers, ...trustedHeaders, ...opts.headers }
          : {},
      })
      return opts.schema ? opts.schema.parse(data) : (data as T)
    } catch (e: any) {
      throw await toError(e, writing)
    }
  }

  /** What a failed request throws: a contract bug passes through, a structured refusal becomes an ApiError. */
  async function toError(e: any, writing: boolean): Promise<Error> {
    // A ZodError is a contract bug, not a user-facing API error: let it
    // propagate unchanged rather than wrapping it as an ApiError.
    if (e?.name === 'ZodError' || e?.cause?.name === 'ZodError') return e
    const status: number = e?.statusCode ?? e?.response?.status ?? 0
    const parsed = structuredError(await errorBody(e?.data))
    if (status === 403 && (parsed.data?.code === TENANT_SUSPENDED || isTenantSuspended())) {
      // The suspension ended the session: every refusal that follows it reads as the suspension itself.
      reportTenantSuspension()
      return new ApiError(status, TENANT_SUSPENDED, t(`errors.codes.${TENANT_SUSPENDED}`))
    }
    if (parsed.success) {
      const { code, field, details, message } = parsed.data
      return new ApiError(status, code, userMessage(status, code, details, message), field, details)
    }
    const message = writing ? saveErrorMessage({ status, message: e?.message }, t('errors.generic'), t('errors.saveUncertain')) : e?.message ?? t('errors.generic')
    return new ApiError(status, 'http_error', message)
  }

  /** The text users see for a structured refusal: always a locale string, never the server's English. */
  function userMessage(status: number, code: string, details: Record<string, unknown> | undefined, serverText: string): string {
    // Structured quota denials name the plan limit that was reached.
    if (code === 'feature_not_included' && details?.reason === 'limit') {
      const key = details.limit_key
      const quota = key === 'users.limit' ? 'users'
        : key === 'projects.max_projects' ? 'projects'
          : key === 'storage.limit_mb' ? 'storage' : 'generic'
      return t(`errors.packageQuota.${quota}`)
    }
    // A business rule may name itself with `details.reason`, or a specific `code`; both are optional locale hooks.
    // Otherwise the server's own text, when it is in the UI language, then the class of refusal.
    const reason = details?.reason
    const specific = [
      typeof reason === 'string' ? `errors.reasons.${reason}` : undefined,
      `errors.codes.${code}`,
    ].find(candidate => candidate && te(candidate))
    if (specific) return t(specific)
    if (serverText && isInUiLanguage(serverText, locale.value)) return serverText
    const candidates = [
      (CLASS_BY_CODE[code] ?? statusKey(status)) && `errors.api.${CLASS_BY_CODE[code] ?? statusKey(status)}`,
    ]
    const key = candidates.find(candidate => candidate && te(candidate))
    return key ? t(key) : t('errors.generic')
  }

  /** A file route: the raw body and the file name the server chose. A refusal is the same ApiError `$api` throws.
   * A file that is kept server-side is a JSON POST (`{ method: 'POST', body }`), never a GET. */
  async function $download(path: string, opts: { method?: string; body?: unknown } = {}): Promise<{ blob: Blob; filename: string | null }> {
    try {
      const response = await $fetch.raw<Blob>(path, {
        responseType: 'blob',
        method: (opts.method ?? 'GET') as any,
        body: opts.body as any,
        ...(opts.method && opts.method !== 'GET' ? { retry: 0 } : {}),
        headers: /^\/api\/v1\/[a-zA-Z0-9_/-]+$/.test(path.split('?')[0] ?? '') && !path.includes('..') ? { ...headers, ...trustedHeaders } : {},
      })
      return { blob: response._data as Blob, filename: contentDispositionFilename(response.headers.get('content-disposition')) }
    } catch (e: any) {
      throw await toError(e, false)
    }
  }

  return { $api, $download }
}
