export type AppearanceMode = 'light' | 'dark'

/** The console's display mode, kept in a cookie so the server renders it before the first paint. */
export function useAppearance() {
  const cookie = usePreferenceCookie<AppearanceMode>('liwan-admin-mode', 'light')
  const mode = computed<AppearanceMode>(() => (cookie.value === 'dark' ? 'dark' : 'light'))
  return { mode, setMode: (value: AppearanceMode) => { cookie.value = value } }
}

/** Puts the mode on <html> (the layer's tokens switch on its `dark` class). Called once, from app.vue, so error.vue honours it too. */
export function useAppearanceHtmlClass() {
  const { mode } = useAppearance()
  useHead(() => ({ htmlAttrs: { class: mode.value === 'dark' ? 'dark' : '' } }))
}
