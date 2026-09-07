export type AppearanceMode = 'light' | 'dark' | 'cream'
export type FontSize = 'small' | 'medium' | 'large'
export interface AppearancePreference {
  mode: AppearanceMode
  fontSize: FontSize
}

export function normalizeAppearance(value: unknown): AppearancePreference {
  const stored = value !== null && typeof value === 'object'
    ? value as Partial<AppearancePreference>
    : {}
  return {
    mode: stored.mode === 'dark' || stored.mode === 'cream' ? stored.mode : 'light',
    fontSize: stored.fontSize === 'medium' || stored.fontSize === 'large' ? stored.fontSize : 'small',
  }
}
