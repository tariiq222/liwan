/** Which shared state a failed load shows (Tasmim spec §6). `ApiError` carries `status`, Nuxt's `createError` `statusCode`. */
export type ErrorStateKind = 'forbidden' | 'notFound' | 'conflict' | 'generic'

export function errorStateKind(error: unknown): ErrorStateKind {
  const value = (typeof error === 'object' && error !== null ? error : {}) as { status?: unknown; statusCode?: unknown }
  const status = value.status ?? value.statusCode
  return status === 403 ? 'forbidden' : status === 404 ? 'notFound' : status === 409 ? 'conflict' : 'generic'
}
