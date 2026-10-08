/**
 * Readable text for an id that has no translation yet: a newer application ships its own
 * labels in its locale file (Phase 4); until then the UI shows `Sales`, never `nasq_sales`
 * or an i18n key.
 */
export function humanizeId(id: string): string {
  const text = id.replace(/^(?:nasq|customer)_/, '').split(/[_.]+/).filter(Boolean).join(' ')
  // An id that strips to nothing (`nasq_`, `..`) returns the raw id rather than an empty label.
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : id
}

/** The role-screen heading of a permission domain; known domains keep their translation. */
export function permissionDomainLabel(domain: string, t: (key: string) => string, te: (key: string) => boolean): string {
  const key = `access.roles.domains.${domain}`
  return te(key) ? t(key) : humanizeId(domain)
}

/**
 * The purpose text of a built-in role. Built-in definitions are read-only seed data whose single
 * stored `description` is not localized, so known keys keep their translation; custom roles and
 * future built-ins show the stored description as-is.
 */
export function builtinRoleDescription(
  role: { type?: string; key: string; description: string },
  t: (key: string) => string,
  te: (key: string) => boolean,
): string {
  if (role.type !== 'built_in') return role.description
  const key = `access.roles.descriptions.${role.key}`
  return te(key) ? t(key) : role.description
}
