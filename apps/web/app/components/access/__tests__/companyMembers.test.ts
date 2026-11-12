import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { setupSfc, mutation } from './sfcSetup'
import { heldRoleOptions } from '../memberRoles'

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}
const role = (id: number) => ({ id, key: `r${id}`, name: { ar: `دور ${id}`, en: `Role ${id}` }, type: 'custom', protected: false })
const member = (id: number, roleIds: number[], version = `v${id}`) => ({
  id, name: `Person ${id}`, login: `p${id}@example.com`, version,
  home_company: { id: 9, name: 'Home' }, company: { id: 1, name: 'Here' },
  assignments: roleIds.map(roleId => ({ id: 100 + roleId, role: role(roleId), scope: { kind: 'company', id: 1, name: 'Here' } })),
})

function members(over: { companyId?: number, roles?: unknown[], caps?: string[], update?: (...args: any[]) => Promise<unknown>, remove?: (...args: any[]) => Promise<unknown> } = {}) {
  const caps = over.caps ?? ['access.users.grant', 'access.users.assign_roles']
  const refetch = vi.fn(async () => undefined)
  const update = vi.fn(over.update ?? (async () => ({})))
  const remove = vi.fn(over.remove ?? (async () => undefined))
  const memberships = vi.fn((..._args: unknown[]) => ({ data: Vue.ref({ items: [member(21, [4]), member(22, [])], total: 2 }), isLoading: Vue.ref(false), error: Vue.ref(null), refetch }))
  const { state } = setupSfc(resolve(import.meta.dirname, '../users/CompanyMembers.vue'), { roles: over.roles ?? [], ...(over.companyId ? { companyId: over.companyId } : {}) }, {
    ApiError, RoleCheckboxes: {}, heldRoleOptions, accessErrorMessage: (cause: Error) => `mapped:${cause.message}`,
    useAccess: () => ({ can: (key: string) => caps.includes(key) }), useMe: () => ({ me: Vue.ref({ company: { id: 1 } }) }),
    useMemberships: memberships, useUpdateMembershipRoles: () => mutation(update), useRemoveMembership: () => mutation(remove),
  })
  return { state, update, remove, refetch, memberships }
}

describe('the members of a company', () => {
  it('lists the working company\'s members, and a branch\'s when the root company names it', () => {
    const working = members()
    expect(Vue.toValue(working.memberships.mock.calls[0]![0] as () => unknown)).toBeUndefined()
    const branch = members({ companyId: 7 })
    expect(Vue.toValue(branch.memberships.mock.calls[0]![0] as () => unknown)).toBe(7)
  })

  it('changes roles at the version the administrator saw, in the working company', async () => {
    const { state, update } = members()
    state.startEdit(state.items.value[0])
    state.editing.value.roleIds = [4, 5]
    await state.saveRoles(state.items.value[0])
    expect(update).toHaveBeenCalledWith({ id: 21, body: { expected_version: 'v21', assignments: [{ role_id: 4, scope: { kind: 'company', id: 1 } }, { role_id: 5, scope: { kind: 'company', id: 1 } }] } })
    expect(state.editing.value).toBeNull()
  })

  it('names the branch in the path of a root administrator: the roles are in the branch and the call carries company_id', async () => {
    const { state, update } = members({ companyId: 7 })
    state.startEdit(state.items.value[0])
    await state.saveRoles(state.items.value[0])
    expect(update).toHaveBeenCalledWith({ id: 21, body: { expected_version: 'v21', assignments: [{ role_id: 4, scope: { kind: 'company', id: 7 } }], company_id: 7 } })
  })

  it('reloads the list and says so when another administrator changed the roles first', async () => {
    const { state, refetch } = members({ update: async () => { throw new ApiError(409, 'conflict', 'stale') } })
    state.startEdit(state.items.value[0])
    await state.saveRoles(state.items.value[0])
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(state.editing.value).toBeNull()
    expect(state.message.value).toBe('access.members.conflict')
  })

  it('shows another refusal with its mapped text and keeps the draft', async () => {
    const { state, refetch } = members({ update: async () => { throw new ApiError(422, 'role_disabled', 'off') } })
    state.startEdit(state.items.value[0])
    await state.saveRoles(state.items.value[0])
    expect(refetch).not.toHaveBeenCalled()
    expect(state.editing.value).not.toBeNull()
    expect(state.message.value).toBe('mapped:off')
  })

  it('removes a member only after a confirmation, naming the branch when there is one', async () => {
    const { state, remove } = members({ companyId: 7 })
    state.startRemove(state.items.value[1])
    expect(remove).not.toHaveBeenCalled()
    await state.confirmRemove()
    expect(remove).toHaveBeenCalledWith({ id: 22, companyId: 7 })
    expect(state.removing.value).toBeNull()
  })

  it('removes in the working company without a company_id', async () => {
    const { state, remove } = members()
    state.startRemove(state.items.value[1])
    await state.confirmRemove()
    expect(remove).toHaveBeenCalledWith({ id: 22, companyId: undefined })
  })

  it('lets a holder of grant alone remove only a member without roles here; role holders also need assign_roles', async () => {
    const { state, remove } = members({ caps: ['access.users.grant'] })
    const [withRoles, withoutRoles] = state.items.value
    expect(state.canRemove(withRoles)).toBe(false)
    expect(state.canRemove(withoutRoles)).toBe(true)
    state.startRemove(withRoles)
    await state.confirmRemove()
    expect(remove).not.toHaveBeenCalled()
    expect(members().state.canRemove(withRoles)).toBe(true)
  })

  it('offers Change roles only to someone who may also read the roles', () => {
    expect(members().state.canChangeRoles.value).toBe(false)
    expect(members({ caps: ['access.users.grant', 'access.users.assign_roles', 'access.roles.read'] }).state.canChangeRoles.value).toBe(true)
    expect(members({ caps: ['access.users.grant', 'access.roles.read'] }).state.canChangeRoles.value).toBe(false)
  })

  it('shows a role the member holds even when it is inactive, warned and clearable', () => {
    const { state } = members({ roles: [{ id: 4, name: { ar: 'x', en: 'x' }, active: false, assignable: true }] })
    state.startEdit(state.items.value[0])
    expect(state.optionsFor(state.items.value[0])).toEqual([{ id: 4, name: { ar: 'x', en: 'x' }, warning: 'access.roles.disabledExistingAssignments', disabled: false }])
  })

  it('is hidden from someone without grant', () => {
    const { state } = members({ caps: ['access.users.assign_roles'] })
    expect(state.canGrant.value).toBe(false)
  })
})
