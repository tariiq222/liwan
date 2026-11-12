type RoleName = { ar: string; en: string | null }

/** A role of a company as the role lists answer it. `assignable` is absent from the branch policy's list, whose roles are all delegable. */
export type RoleCandidate = { id: number; name: RoleName; active: boolean; assignable?: boolean; company_id?: number | null }
export type MemberRoleOption = { id: number; name: RoleName; warning?: string; disabled?: boolean }

/** A role may be newly given to a member of `companyId`: active, assignable, and the company-wide ones or that company's own. */
export function isOfferable(role: RoleCandidate, companyId: number | undefined): boolean {
  return role.active && role.assignable !== false && (role.company_id == null || companyId === undefined || role.company_id === companyId)
}

/** The roles a new member can be given: the one rule both member editors offer. */
export function offerableRoles(roles: RoleCandidate[], companyId: number | undefined): MemberRoleOption[] {
  return roles.filter(role => isOfferable(role, companyId)).map(({ id, name }) => ({ id, name }))
}

/**
 * The roles shown while editing one member: the offerable ones, and every role the member already holds, so none is hidden
 * with no way to clear it. A held role that is no longer offerable carries the warning and can be cleared but not chosen again.
 */
export function heldRoleOptions(
  roles: RoleCandidate[],
  companyId: number | undefined,
  held: { id: number; name: RoleName }[],
  checked: number[],
  warning: string,
): MemberRoleOption[] {
  const heldIds = new Set(held.map(role => role.id))
  const known = new Set(roles.map(role => role.id))
  const candidates = roles.filter(role => isOfferable(role, companyId) || heldIds.has(role.id))
  return [
    ...candidates.map((role): MemberRoleOption => {
      const offerable = isOfferable(role, companyId)
      return { id: role.id, name: role.name, ...(offerable ? {} : { warning, disabled: !checked.includes(role.id) }) }
    }),
    // A held role the list does not carry (for example when roles cannot be read) is still shown from the membership itself.
    ...held.filter(role => !known.has(role.id)).map((role): MemberRoleOption => ({ id: role.id, name: role.name, warning, disabled: !checked.includes(role.id) })),
  ]
}
