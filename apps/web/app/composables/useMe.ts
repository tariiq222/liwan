import { MeSchema, type Me } from '@nasq/contracts'

// Pure and Nuxt-import-free so it can be unit tested directly: 403 means "not
// logged in" (redirect to /login); any other error is a genuine server failure
// that must not be silently treated the same way.
export function isLoggedOutError(error: unknown): boolean {
  return (error as { statusCode?: number } | null | undefined)?.statusCode === 403
}

export function useMe() {
  const headers = useRequestHeaders(['cookie'])
  const request = useFetch<Me | null>('/api/v1/me', {
    key: 'me',
    headers,
    transform: (raw) => (raw ? MeSchema.parse(raw) : null),
    // 403 = not logged in; surface as null instead of an error
    onResponseError({ response }) { if (response.status === 403) response._data = null },
  })
  const { data, refresh, error } = request
  const me = computed(() => (error.value ? null : data.value ?? null))
  const loggedIn = computed(() => me.value !== null)
  return { me, refresh, loggedIn, error, ready: request }
}
