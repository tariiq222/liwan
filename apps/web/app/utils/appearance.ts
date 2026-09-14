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

export interface HtmlAttrsInput {
  mode: AppearanceMode
  fontSize: FontSize
  lang?: string
  dir?: string
}

export interface HtmlAttrs {
  class: '' | 'dark' | 'cream'
  'data-font-size': FontSize
  lang?: string
  dir?: string
}

export function htmlAttrsFor({ mode, fontSize, lang, dir }: HtmlAttrsInput): HtmlAttrs {
  return {
    class: mode === 'dark' ? 'dark' : mode === 'cream' ? 'cream' : '',
    'data-font-size': fontSize,
    lang,
    dir,
  }
}
