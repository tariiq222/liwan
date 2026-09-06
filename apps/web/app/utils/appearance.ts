export type AppearanceMode = 'light' | 'dark'
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
    mode: stored.mode === 'dark' ? 'dark' : 'light',
    fontSize: stored.fontSize === 'medium' || stored.fontSize === 'large' ? stored.fontSize : 'small',
  }
}
