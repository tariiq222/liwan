/**
 * Readable text for an id that has no translation yet: a newer application ships its own
 * labels in its locale file (Phase 4); until then the UI shows `Sales`, never `nasq_sales`
 * or an i18n key.
 */
export function humanizeId(id: string): string {
  const text = id.replace(/^(?:nasq|customer)_/, '').split(/[_.]+/).filter(Boolean).join(' ')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : id
}

/** The role-screen heading of a permission domain; known domains keep their translation. */
export function permissionDomainLabel(domain: string, t: (key: string) => string, te: (key: string) => boolean): string {
  const key = `access.roles.domains.${domain}`
  return te(key) ? t(key) : humanizeId(domain)
}
