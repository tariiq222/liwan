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

// The server keeps one preference per user (`/api/v1/me.appearance`); the
// wire names differ from the client ones only in `font_size`.
export interface WireAppearance {
  mode: AppearanceMode
  font_size: FontSize
}

export function appearanceFromWire(value: WireAppearance | null | undefined): AppearancePreference {
  return normalizeAppearance(value ? { mode: value.mode, fontSize: value.font_size } : null)
}

export function appearancePatchBody(patch: Partial<AppearancePreference>): Partial<WireAppearance> {
  const body: Partial<WireAppearance> = {}
  if (patch.mode !== undefined) body.mode = patch.mode
  if (patch.fontSize !== undefined) body.font_size = patch.fontSize
  return body
}

export function sameAppearance(left: AppearancePreference, right: AppearancePreference): boolean {
  return left.mode === right.mode && left.fontSize === right.fontSize
}

// `useHead` types `htmlAttrs.dir` as this union, so the loose `string` that
// `useLocaleHead()` and `localeProperties.dir` hand us is narrowed here once
// instead of being cast at every call site.
export type HtmlDir = 'ltr' | 'rtl' | 'auto'

function normalizeDir(value: string | undefined): HtmlDir | undefined {
  return value === 'ltr' || value === 'rtl' || value === 'auto' ? value : undefined
}

export interface HtmlAttrsInput {
  mode: AppearanceMode
  fontSize: FontSize
  lang?: string
  dir?: string
}

// A type alias, not an interface: `useHead` expects `htmlAttrs` to carry
// template-literal index signatures (`xmlns:*`, `data-*`), and TypeScript
// infers those implicitly for aliases but never for interfaces.
export type HtmlAttrs = {
  class: '' | 'dark' | 'cream'
  'data-font-size': FontSize
  lang?: string
  dir?: HtmlDir
}

export function htmlAttrsFor({ mode, fontSize, lang, dir }: HtmlAttrsInput): HtmlAttrs {
  return {
    class: mode === 'dark' ? 'dark' : mode === 'cream' ? 'cream' : '',
    'data-font-size': fontSize,
    lang,
    dir: normalizeDir(dir),
  }
}
