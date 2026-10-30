/**
 * Readable text for an id that has no translation yet, so a screen shows `Sales`, never
 * `liwan_sales` or an i18n key.
 */
export function humanizeId(id: string): string {
  const text = id.replace(/^(?:liwan|customer)_/, '').split(/[_.]+/).filter(Boolean).join(' ')
  // An id that strips to nothing (`liwan_`, `..`) returns the raw id rather than an empty label.
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : id
}
