type Translate = (key: string) => string

/**
 * Joins names, tags or roles for display with the current locale's list separator («، » in Arabic, ", " in
 * English). The separator is a translated string, so a shared component never writes '، ' in its own source:
 * that is how an Arabic comma reached the English interface. The key is `states.listSeparator`, owned by this
 * layer because the merged message set forbids two layers owning one path. The name differs from the
 * application-side joiner so Nuxt's per-layer auto-import registry keeps one owner per name.
 */
export function joinLocaleList(items: readonly string[], t: Translate): string {
  return items.join(t('states.listSeparator'))
}
