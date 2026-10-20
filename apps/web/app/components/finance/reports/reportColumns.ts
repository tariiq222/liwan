import type { TableColumn } from '@nuxt/ui'

/** A column of amounts: header and cells end-aligned (start-aligned numbers read badly in RTL tables). */
export function amountColumn<T>(id: string, header: string): TableColumn<T> {
  return { id, header, meta: { class: { th: 'text-end', td: 'text-end' } } }
}
