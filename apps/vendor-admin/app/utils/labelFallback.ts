/**
 * Readable text for an id that has no translation yet, so the console shows `Sales`, never
 * `nasq_sales` or an i18n key.
 */
export function humanizeId(id: string): string {
  const text = id.replace(/^(?:nasq|customer)_/, '').split(/[_.]+/).filter(Boolean).join(' ')
  // An id that strips to nothing (`nasq_`, `..`) returns the raw id rather than an empty label.
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : id
}
