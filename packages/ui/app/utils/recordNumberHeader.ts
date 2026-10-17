import { h } from 'vue'

/** The record-number column header: the symbol `#`, with the full word kept for screen readers and as the tooltip. */
export function recordNumberHeader(t: (key: string) => string) {
  const label = t('app.recordNumber')
  return h('span', { title: label }, [h('span', { 'aria-hidden': 'true' }, '#'), h('span', { class: 'sr-only' }, label)])
}
