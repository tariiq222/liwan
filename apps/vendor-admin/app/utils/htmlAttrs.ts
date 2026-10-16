export type HtmlDir = 'ltr' | 'rtl' | 'auto'

function normalizeDir(value: string | undefined): HtmlDir | undefined {
  return value === 'ltr' || value === 'rtl' || value === 'auto' ? value : undefined
}

// Language and direction only; the display mode is applied by useAppearance.
export function htmlAttrsFor({ lang, dir }: { lang?: string, dir?: string }) {
  return { lang, dir: normalizeDir(dir) }
}
