import { normalizeAppearance, type AppearanceMode, type AppearancePreference, type FontSize } from '@/utils/appearance'

export function useAppearance() {
  // A cookie renders the chosen appearance on the server, before the first paint.
  const cookie = useCookie<AppearancePreference>('nasq-appearance', {
    default: () => normalizeAppearance(null),
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  })
  const preference = useState<AppearancePreference>('appearance', () => normalizeAppearance(cookie.value))

  function update(patch: Partial<AppearancePreference>) {
    preference.value = normalizeAppearance({ ...preference.value, ...patch })
    cookie.value = { ...preference.value }
  }

  return {
    mode: computed(() => preference.value.mode),
    fontSize: computed(() => preference.value.fontSize),
    setMode: (mode: AppearanceMode) => update({ mode }),
    setFontSize: (fontSize: FontSize) => update({ fontSize }),
  }
}
