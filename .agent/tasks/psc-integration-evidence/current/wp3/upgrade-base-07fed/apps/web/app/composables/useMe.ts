import { MeSchema, type Me } from '@nasq/contracts'

// Pure and Nuxt-import-free so it can be unit tested directly: 403 means "not
// logged in" (redirect to /login); any other error is a genuine server failure
// that must not be silently treated the same way.
export function isLoggedOutError(error: unknown): boolean {
  return (error as { statusCode?: number } | null | undefined)?.statusCode === 403
}

// A zod failure thrown inside `transform` reaches us wrapped: Nuxt's useAsyncData
// catches the thrown ZodError and rewraps it with h3's `createError(error)`, which
// produces an H3Error (statusCode: 500) that preserves the original as `.cause`.
// So a schema error is never a bare ZodError in practice - it's an H3Error wrapper
// around one. Detect both the wrapped and bare shapes without gating on statusCode,
// since the wrapper's statusCode (500) does not distinguish it from other server errors.
export function isSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: string; cause?: unknown; data?: { name?: string } }
  if (e.name === 'ZodError') return true
  if (e.cause && typeof e.cause === 'object' && (e.cause as { name?: string }).name === 'ZodError') return true
  if (e.data?.name === 'ZodError') return true
  return false
}

export function useMe() {
  const headers = useRequestHeaders(['cookie'])
  const request = useFetch<Me | null>('/api/v1/me', {
    key: 'me',
    headers,
    // 403 = not logged in: the request still errors, and `me` resolves to null below.
    transform: (raw) => (raw ? MeSchema.parse(raw) : null),
  })
  const { data, refresh, error } = request
  const me = computed(() => (error.value ? null : data.value ?? null))
  const loggedIn = computed(() => me.value !== null)
  return { me, refresh, loggedIn, error, ready: request }
}
