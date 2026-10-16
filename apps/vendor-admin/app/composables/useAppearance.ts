export type AppearanceMode = 'light' | 'dark'

/**
 * The console's display mode. A cookie keeps the choice and renders it on the server before the
 * first paint; the layer's tokens switch on the `dark` class of <html>.
 */
export function useAppearance() {
  const cookie = useCookie<AppearanceMode>('nasq-admin-mode', {
    default: () => 'light',
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  })
  const mode = computed<AppearanceMode>(() => (cookie.value === 'dark' ? 'dark' : 'light'))
  useHead(() => ({ htmlAttrs: { class: mode.value === 'dark' ? 'dark' : '' } }))
  return { mode, setMode: (value: AppearanceMode) => { cookie.value = value } }
}
