import { humanizeId } from '@webvue/ui/app/utils/humanizeId'

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
