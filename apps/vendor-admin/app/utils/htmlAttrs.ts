export type HtmlDir = 'ltr' | 'rtl' | 'auto'

function normalizeDir(value: string | undefined): HtmlDir | undefined {
  return value === 'ltr' || value === 'rtl' || value === 'auto' ? value : undefined
}

// The vendor console has a single light appearance; the attributes mirror what the layer's CSS reads.
export function htmlAttrsFor({ lang, dir }: { lang?: string, dir?: string }) {
  return { class: '' as const, 'data-font-size': 'small' as const, lang, dir: normalizeDir(dir) }
}
