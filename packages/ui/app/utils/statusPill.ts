import type { StatusTone } from './statusTone'

/**
 * The one status pill (a status badge, a priority, a deadline): 24px high, full radius, a 1px border, soft fill and
 * foreground text from the `--status-*` tokens (neutral: the hairline and elevated surface). `interactive` is for the
 * editable ones (a state or priority menu trigger): a gentle hover, a visible focus ring. The look lives in components.css.
 */
export function statusPillAttrs(tone: StatusTone, interactive = false) {
  return { class: 'webvue-pill', 'data-tone': tone, 'data-interactive': interactive ? '' : undefined }
}
