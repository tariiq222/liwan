type Translate = (key: string) => string

/** Joins names, tags or roles for display with the current locale's list separator («، » in Arabic, ", " in English). */
export function joinList(items: readonly string[], t: Translate): string {
  return items.join(t('app.listSeparator'))
}
