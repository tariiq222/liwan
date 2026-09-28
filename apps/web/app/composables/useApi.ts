import type { ZodType } from 'zod'
import { ApiErrorSchema } from '@nasq/contracts'

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

export function useApi() {
  // Cookie forwarding is only meaningful during SSR: on the client the browser
  // already attaches the session cookie to same-origin requests.
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : {}
  // Only middleware-validated server events may supply private hop identity.
  // This stays in the SSR closure, never in returned data or the client payload.
  const trustedHeaders = import.meta.server && useRequestEvent()?.context.tenant
    ? useRequestHeaders(['host', 'x-nasq-proxy-token', 'x-nasq-tenant-revision'])
    : {}

  async function $api<T>(
    path: string,
    opts: { method?: string; body?: unknown; query?: Record<string, unknown>; schema?: ZodType<T> } = {},
  ): Promise<T> {
    try {
      const data = await $fetch<unknown>(path, {
        method: (opts.method ?? 'GET') as any,
        body: opts.body as any,
        query: opts.query,
        // Never forward a cookie or private hop identity to an absolute URL,
        // protocol-relative URL, encoded path or normalized traversal target.
        headers: /^\/api\/v1\/[a-zA-Z0-9_/-]+$/.test(path) && !path.includes('..')
          ? { ...headers, ...trustedHeaders }
          : {},
      })
      return opts.schema ? opts.schema.parse(data) : (data as T)
    } catch (e: any) {
      // A ZodError is a contract bug, not a user-facing API error: let it
      // propagate unchanged rather than wrapping it as an ApiError.
      if (e?.name === 'ZodError' || e?.cause?.name === 'ZodError') throw e
      const status: number = e?.statusCode ?? e?.response?.status ?? 0
      const parsed = ApiErrorSchema.safeParse(e?.data)
      if (parsed.success) throw new ApiError(status, parsed.data.code, parsed.data.message, parsed.data.field, parsed.data.details)
      throw new ApiError(status, 'http_error', e?.message ?? 'request failed')
    }
  }

  return { $api }
}
