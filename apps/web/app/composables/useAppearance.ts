import { MeSchema, type Me } from '@liwan/contracts'
import {
  appearanceFromWire,
  appearancePatchBody,
  normalizeAppearance,
  sameAppearance,
  type AppearanceMode,
  type AppearancePreference,
  type FontSize,
} from '@/utils/appearance'

export function useAppearance() {
  // A cookie renders the last applied appearance on the server, before the
  // first paint. The preference itself belongs to the signed-in user: it is
  // loaded from `/api/v1/me` once per user and written back on every change,
  // so two people sharing a browser each keep their own.
  const cookie = useCookie<AppearancePreference>('liwan-appearance', {
    default: () => normalizeAppearance(null),
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  })
  const preference = useState<AppearancePreference>('appearance', () => normalizeAppearance(cookie.value))
  const syncedUserId = useState<number | null>('appearance-user', () => null)
  const { $api } = useApi()

  function apply(patch: Partial<AppearancePreference>) {
    preference.value = normalizeAppearance({ ...preference.value, ...patch })
    cookie.value = { ...preference.value }
  }

  async function persist(patch: Partial<AppearancePreference>) {
    if (!syncedUserId.value) return
    try {
      await $api('/api/v1/me/appearance', { method: 'PATCH', body: appearancePatchBody(patch), schema: MeSchema })
    }
    catch {
      // The choice already applies locally; the next sign-in reloads the
      // server copy, so a failed write never blocks the user.
    }
  }

  function update(patch: Partial<AppearancePreference>) {
    apply(patch)
    void persist(patch)
  }

  // Called once per signed-in user (see app.vue): the server copy wins over
  // whatever the previous user left in this browser's cookie.
  function syncFromUser(me: Me | null | undefined) {
    if (!me) {
      syncedUserId.value = null
      return
    }
    if (syncedUserId.value === me.id) return
    syncedUserId.value = me.id
    if (!me.appearance) return
    const stored = appearanceFromWire(me.appearance)
    if (!sameAppearance(stored, preference.value)) apply(stored)
  }

  return {
    mode: computed(() => preference.value.mode),
    fontSize: computed(() => preference.value.fontSize),
    setMode: (mode: AppearanceMode) => update({ mode }),
    setFontSize: (fontSize: FontSize) => update({ fontSize }),
    syncFromUser,
  }
}
