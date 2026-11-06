import { MeSchema, MobileInputSchema, type Me } from '@liwan/contracts'

// Pure and Nuxt-import-free so it can be unit tested directly: 401 means "not
// logged in" (redirect to /login), and 403 is the suspension that ended the session;
// any other error is a genuine server failure that must not be silently treated the same way.
export function isLoggedOutError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: number } | null | undefined)?.statusCode
  return statusCode === 401 || statusCode === 403
}

// The tenant is suspended: the API ended this session, so the user is logged out and the
// login page must say why instead of showing an empty form.
// Odoo's body carries the code at `data.code`; the Nitro session admission wraps it at `data.data.code`.
export function isTenantSuspendedError(error: unknown): boolean {
  const e = error as { statusCode?: number; data?: { code?: unknown; data?: { code?: unknown } } } | null | undefined
  return isLoggedOutError(e) && (e?.data?.code ?? e?.data?.data?.code) === 'tenant_suspended'
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
  // Nuxt's default SSR initial cache reads static data, so later consumers can
  // fetch again after middleware resolved this request's identity. Reuse that
  // identity while rendering and while hydrating: Nuxt turns `immediate` into a
  // server-prefetch boundary on both sides, and Vue derives `useId` from those
  // boundaries, so the server and the hydrating client must decide it the same
  // way. Later client refresh/cancellation stays unchanged.
  const initialMe = import.meta.server || useNuxtApp().isHydrating ? useNuxtData<Me | null>('me').data.value : undefined
  const request = useFetch<Me | null>('/api/v1/me', {
    key: 'me',
    headers,
    immediate: initialMe === undefined,
    dedupe: import.meta.server ? 'defer' : 'cancel',
    // 401 = not logged in: the request still errors, and `me` resolves to null below.
    transform: (raw) => (raw ? MeSchema.parse(raw) : null),
  })
  const { data, refresh, error } = request
  const me = computed(() => (error.value ? null : data.value ?? null))
  const loggedIn = computed(() => me.value !== null)
  return { me, refresh, loggedIn, error, ready: request }
}

/** Where a signed-in user who has no mobile number yet is sent, and the only page besides sign-out that answers meanwhile. */
export const MOBILE_STEP_PATH = '/account/mobile'

/**
 * The route to send `me` to instead of `to`: the mobile step while the server says a number is required. A public page
 * needs no identity, and the step itself is where the user is going.
 */
export function mobileStepRedirect(
  me: Pick<Me, 'mobile_required'> | null,
  to: { path: string; fullPath: string; meta?: { access?: string } },
): { path: string; query?: { next: string } } | null {
  if (!me?.mobile_required || to.meta?.access === 'public' || to.path === MOBILE_STEP_PATH) return null
  return to.fullPath === '/' ? { path: MOBILE_STEP_PATH } : { path: MOBILE_STEP_PATH, query: { next: to.fullPath } }
}

/**
 * What a person typed as E.164: the default country is +966, so a local number (05xxxxxxxx or 5xxxxxxxx) gets it.
 * Anything else is returned cleaned but otherwise as typed, for the contract to accept or refuse.
 */
export function normalizeMobileInput(raw: string): string {
  const typed = raw.replace(/[\s\-().]/g, '')
  if (typed.startsWith('+')) return typed
  if (typed.startsWith('00')) return `+${typed.slice(2)}`
  if (typed.startsWith('966')) return `+${typed}`
  if (typed.startsWith('0')) return `+966${typed.slice(1)}`
  return /^5\d{8}$/.test(typed) ? `+966${typed}` : typed
}

/** Saves the signed-in user's own mobile number (the server checks the format and that no one else holds it), then reloads `me`. */
export function useSaveOwnMobile() {
  const { $api } = useApi()
  return async (mobile: string): Promise<Me> => {
    const body = MobileInputSchema.parse({ mobile })
    const saved = await $api('/api/v1/me/mobile', { method: 'PATCH', body, schema: MeSchema })
    await refreshNuxtData('me')
    return saved
  }
}
