import { MeSchema, type Me } from '@nasq/contracts'

// Pure and Nuxt-import-free so it can be unit tested directly: 403 means "not
// logged in" (redirect to /login); any other error is a genuine server failure
// that must not be silently treated the same way.
export function isLoggedOutError(error: unknown): boolean {
  return (error as { statusCode?: number } | null | undefined)?.statusCode === 403
}

// A zod failure thrown inside `transform` reaches us as a plain Error with no
// statusCode: the server answered, our contract no longer matches it. That is a
// different fault from "the server is unreachable" and deserves its own message.
export function isSchemaError(error: unknown): boolean {
  const e = error as { statusCode?: number; name?: string; message?: string } | null | undefined
  if (!e || e.statusCode) return false
  return e.name === 'ZodError' || /ZodError|invalid/i.test(e.message ?? '')
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
