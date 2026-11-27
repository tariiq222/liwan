import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import { setupSfc, mutation } from './sfcSetup'
import { heldRoleOptions, offerableRoles } from '../memberRoles'
import { ApiError as RealApiError } from '../../../composables/useApi'
import { queryPositiveInt } from '../../../utils/routeQuery'
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}
const role = (id: number) => ({ id, key: `r${id}`, name: { ar: `دور ${id}`, en: `Role ${id}` }, type: 'custom', protected: false })
const member = (id: number, roleIds: number[], version = `v${id}`) => ({
  id, name: `Person ${id}`, login: `p${id}@example.com`, version,
  home_company: { id: 9, name: 'Home' }, company: { id: 1, name: 'Here' },
  assignments: roleIds.map(roleId => ({ id: 100 + roleId, role: role(roleId), scope: { kind: 'company', id: 1, name: 'Here' } })),
})

function members(over: { companyId?: number, roles?: unknown[], caps?: string[], remove?: (...args: any[]) => Promise<unknown> } = {}) {
  const caps = over.caps ?? ['access.users.grant', 'access.users.assign_roles']
  const remove = vi.fn(over.remove ?? (async () => undefined))
  const memberships = vi.fn((..._args: unknown[]) => ({ data: Vue.ref({ items: [member(21, [4]), member(22, [])], total: 2 }), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }))
  const { state } = setupSfc(resolve(import.meta.dirname, '../users/CompanyMembers.vue'), { roles: over.roles ?? [], ...(over.companyId ? { companyId: over.companyId } : {}) }, {
    ApiError, accessErrorMessage: (cause: Error) => `mapped:${cause.message}`,
    useAccess: () => ({ can: (key: string) => caps.includes(key) }),
    useMemberships: memberships, useRemoveMembership: () => mutation(remove),
  })
  return { state, remove, memberships }
}

/** Renders the component's template against the setup state with every child stubbed, capturing each child's props. */
async function renderedMembers(over: Parameters<typeof members>[0] = {}) {
  const { state, remove, memberships } = members(over)
  const filename = resolve(import.meta.dirname, '../users/CompanyMembers.vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const compiled = compileTemplate({ source: descriptor.template!.content, filename, id: 'members', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', ts.transpileModule(compiled.code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText)(Vue)
  const nodes: { name: string; props: Record<string, any> }[] = []
  const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => ({ ...state.props, ...Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))) }), render }))
  for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(match => match[1]!))) {
    app.component(name, Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
      return () => { nodes.push({ name, props: { ...attrs } }); return Vue.h('div', [slots.default?.()]) }
    } }))
  }
  await renderToString(app)
  return { state, remove, memberships, nodes }
}

function rolesForm(over: { companyId?: number, roles?: unknown[], memberRoles?: number[], update?: (...args: any[]) => Promise<unknown>, reload?: (...args: any[]) => Promise<unknown> } = {}) {
  const update = vi.fn(over.update ?? (async () => ({})))
  const reloadMember = vi.fn(over.reload ?? (async () => ({ items: [member(21, [4])] })))
  const { state, emit } = setupSfc(resolve(import.meta.dirname, '../users/MemberRolesForm.vue'), { member: member(21, over.memberRoles ?? [4]), roles: over.roles ?? [], ...(over.companyId ? { companyId: over.companyId } : {}), reloadMember }, {
    ApiError: RealApiError, RoleCheckboxes: {}, heldRoleOptions, accessErrorMessage: (cause: Error) => `mapped:${cause.message}`,
    useMe: () => ({ me: Vue.ref({ company: { id: 1 } }) }), useUpdateMembershipRoles: () => mutation(update), useId: () => 'roles-form',
  })
  return { state, emit, update, reloadMember }
}

describe('the members of a company', () => {
  it('lists the working company\'s members, and a branch\'s when the root company names it', () => {
    const working = members()
    expect(Vue.toValue(working.memberships.mock.calls[0]![0] as () => unknown)).toBeUndefined()
    const branch = members({ companyId: 7 })
    expect(Vue.toValue(branch.memberships.mock.calls[0]![0] as () => unknown)).toBe(7)
  })

  it('sends Change roles to the member edit page with the branch in the query', async () => {
    const caps = ['access.users.grant', 'access.users.assign_roles', 'access.roles.read']
    const { nodes } = await renderedMembers({ companyId: 7, caps })
    const link = nodes.find(node => node.name === 'UButton' && node.props['data-testid'] === 'member-change-roles')
    expect(link?.props.to).toEqual({ path: '/settings/team/members/21/edit', query: { company_id: '7', returnTo: '/settings/team/branches#branch-members' } })
  })

  it('sends Change roles of a working-company member back to the users section', async () => {
    const caps = ['access.users.grant', 'access.users.assign_roles', 'access.roles.read']
    const { nodes } = await renderedMembers({ caps })
    const link = nodes.find(node => node.name === 'UButton' && node.props['data-testid'] === 'member-change-roles')
    expect(link?.props.to).toEqual({ path: '/settings/team/members/21/edit', query: { returnTo: '/settings/team/users#members' } })
  })

  it('offers Change roles only to someone who may also read the roles', async () => {
    const hidden = await renderedMembers({ caps: ['access.users.grant', 'access.users.assign_roles'] })
    expect(hidden.nodes.some(node => node.props['data-testid'] === 'member-change-roles')).toBe(false)
    const shown = await renderedMembers({ caps: ['access.users.grant', 'access.users.assign_roles', 'access.roles.read'] })
    expect(shown.nodes.some(node => node.props['data-testid'] === 'member-change-roles')).toBe(true)
    expect(members().state.canChangeRoles.value).toBe(false)
    expect(members({ caps: ['access.users.grant', 'access.roles.read'] }).state.canChangeRoles.value).toBe(false)
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

  it('is hidden from someone without grant', () => {
    const { state } = members({ caps: ['access.users.assign_roles'] })
    expect(state.canGrant.value).toBe(false)
  })
})

describe('the roles form of one member', () => {
  it('saves the checked roles at the version the administrator saw, in the branch, and marks saved before emitting done', async () => {
    const dirtyWhenDone: boolean[] = []
    const { state, update, emit } = rolesForm({ companyId: 7 })
    emit.mockImplementation((event: string) => {
      if (event === 'done') dirtyWhenDone.push(state.dirty.value)
    })
    state.roleIds.value = [4, 5]
    expect(state.dirty.value).toBe(true)
    await state.saveRoles()
    expect(update).toHaveBeenCalledWith({ id: 21, body: { expected_version: 'v21', assignments: [{ role_id: 4, scope: { kind: 'company', id: 7 } }, { role_id: 5, scope: { kind: 'company', id: 7 } }], company_id: 7 } })
    expect(state.saved.value).toBe(true)
    expect(state.dirty.value).toBe(false)
    expect(dirtyWhenDone).toEqual([false])
    expect(emit).toHaveBeenCalledWith('done')
  })

  it('scopes the roles of a working-company member to the working company and sends no company_id', async () => {
    const { state, update } = rolesForm()
    await state.saveRoles()
    expect(update).toHaveBeenCalledWith({ id: 21, body: { expected_version: 'v21', assignments: [{ role_id: 4, scope: { kind: 'company', id: 1 } }] } })
  })

  it('locks the stale draft on 409 conflict, keeps it locked if reload fails, and unlocks after a clean reload', async () => {
    let failReload = true
    const { state, update, emit, reloadMember } = rolesForm({
      update: async () => { throw new RealApiError(409, 'conflict', 'stale') },
      reload: async () => {
        if (failReload) throw new RealApiError(500, 'server_error', 'boom')
        return { items: [member(21, [4])] }
      },
    })
    state.roleIds.value = [9]
    await state.saveRoles()
    expect(update).toHaveBeenCalledTimes(1)
    expect(state.conflict.value).toBe(true)
    expect(state.busy.value).toBe(true)
    expect(emit).not.toHaveBeenCalled()
    expect(state.roleIds.value).toEqual([9])
    // A second save attempt while locked is refused.
    await state.saveRoles()
    expect(update).toHaveBeenCalledTimes(1)
    // A failed reload keeps the stale draft locked.
    await state.reloadDraft()
    expect(reloadMember).toHaveBeenCalledTimes(1)
    expect(state.reloading.value).toBe(false)
    expect(state.conflict.value).toBe(true)
    expect(state.busy.value).toBe(true)
    expect(state.message.value).toBe('mapped:boom')
    expect(state.roleIds.value).toEqual([9])
    // Once reload succeeds, the draft resets and unlocks.
    failReload = false
    await state.reloadDraft()
    expect(reloadMember).toHaveBeenCalledTimes(2)
    expect(state.reloading.value).toBe(false)
    expect(state.conflict.value).toBe(false)
    expect(state.busy.value).toBe(false)
    expect(state.message.value).toBe('')
    expect(state.roleIds.value).toEqual([4])
  })

  it('shows another refusal with its mapped text and keeps the draft', async () => {
    const { state, emit } = rolesForm({ update: async () => { throw new RealApiError(422, 'role_disabled', 'off') } })
    state.roleIds.value = [5]
    await state.saveRoles()
    expect(state.conflict.value).toBe(false)
    expect(state.message.value).toBe('mapped:off')
    expect(state.roleIds.value).toEqual([5])
    expect(emit).not.toHaveBeenCalled()
  })

  it('tracks the draft against the member\'s own roles, whatever the checked order', () => {
    const { state } = rolesForm()
    expect(state.dirty.value).toBe(false)
    state.roleIds.value = [4, 5]
    expect(state.dirty.value).toBe(true)
    const two = rolesForm({ memberRoles: [4, 5] })
    expect(two.state.dirty.value).toBe(false)
    two.state.roleIds.value = [5, 4]
    expect(two.state.dirty.value).toBe(false)
  })

  it('shows a role the member holds even when it is inactive, warned and clearable', () => {
    const { state } = rolesForm({ roles: [{ id: 4, name: { ar: 'x', en: 'x' }, active: false, assignable: true }] })
    expect(state.options.value).toEqual([{ id: 4, name: { ar: 'x', en: 'x' }, warning: 'access.roles.disabledExistingAssignments', disabled: false }])
  })
})

describe('the member routes', () => {
  function mountNewMember(over: { query?: Record<string, unknown>; caps?: string[]; branches?: { id: number; name: string }[] | null; branchError?: unknown; rolesError?: unknown } = {}) {
    const caps = over.caps ?? ['access.users.grant', 'access.roles.read']
    const refetchBranches = vi.fn()
    const refetchRoles = vi.fn()
    let branchesEnabled!: Vue.Ref<boolean>
    let rolesEnabled!: Vue.Ref<boolean>
    const { state } = setupSfc(resolve(import.meta.dirname, '../../../pages/settings/team/members/new.vue'), {}, {
      ApiError: RealApiError, safeReturnTo, queryPositiveInt, MemberAddForm: {}, offerableRoles,
      useRoute: () => ({ query: over.query ?? {} }),
      useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
      useAccess: () => ({ can: (key: string) => caps.includes(key) }),
      useMembershipBranches: (enabled: Vue.Ref<boolean>) => {
        branchesEnabled = enabled
        return { data: Vue.ref(over.branches === null ? undefined : { items: over.branches ?? [{ id: 7, name: 'Jeddah' }], total: 1 }), error: Vue.ref(over.branchError ?? null), isLoading: Vue.ref(false), refetch: refetchBranches }
      },
      useAdminRoles: (_params: unknown, enabled: Vue.Ref<boolean>) => {
        rolesEnabled = enabled
        return { data: Vue.ref({ items: [{ id: 4, name: { ar: 'دور', en: 'Role' }, active: true, assignable: true, company_id: null }], total: 1 }), error: Vue.ref(over.rolesError ?? null), isLoading: Vue.ref(false), refetch: refetchRoles }
      },
    })
    return { state, branchesEnabled: Vue.unref(branchesEnabled), rolesEnabled: Vue.unref(rolesEnabled), refetchBranches, refetchRoles }
  }

  function mountEditMember(over: { memberId?: string; query?: Record<string, unknown>; caps?: string[]; items?: ReturnType<typeof member>[] | null; listError?: unknown; rolesError?: unknown } = {}) {
    const caps = over.caps ?? ['access.users.grant', 'access.users.assign_roles', 'access.roles.read']
    const refetchList = vi.fn(async () => ({ isError: false, data: { items: over.items ?? [member(21, [4])] } }))
    const refetchRoles = vi.fn()
    let listCompanyArg: (() => number | undefined) | undefined
    let listEnabled!: Vue.Ref<boolean>
    let rolesEnabled!: Vue.Ref<boolean>
    const { state } = setupSfc(resolve(import.meta.dirname, '../../../pages/settings/team/members/[memberId]/edit.vue'), {}, {
      ApiError: RealApiError, safeReturnTo, queryPositiveInt, MemberRolesForm: {},
      useRoute: () => ({ params: { memberId: over.memberId ?? '21' }, query: over.query ?? {} }),
      useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
      useAccess: () => ({ can: (key: string) => caps.includes(key) }),
      useMemberships: (companyId: () => number | undefined, enabled: Vue.Ref<boolean>) => {
        listCompanyArg = companyId
        listEnabled = enabled
        return { data: Vue.ref(over.items === null ? undefined : { items: over.items ?? [member(21, [4])], total: 1 }), error: Vue.ref(over.listError ?? null), isLoading: Vue.ref(false), refetch: refetchList }
      },
      useAdminRoles: (_params: unknown, enabled: Vue.Ref<boolean>) => {
        rolesEnabled = enabled
        return { data: Vue.ref({ items: [], total: 0 }), error: Vue.ref(over.rolesError ?? null), isLoading: Vue.ref(false), refetch: refetchRoles }
      },
    })
    return { state, listCompany: listCompanyArg?.(), listEnabled: Vue.unref(listEnabled), rolesEnabled: Vue.unref(rolesEnabled), refetchList, refetchRoles }
  }

  it('members/new.vue gates queries on grant and valid company_id, surfaces API errors without masking as 404, and rejects unknown branches', () => {
    const missing = mountNewMember({ query: {} })
    expect(missing.branchesEnabled).toBe(false)
    expect(missing.rolesEnabled).toBe(false)
    expect(missing.state.pageError.value).toBeInstanceOf(RealApiError)
    expect(missing.state.pageError.value.status).toBe(404)

    const unauthorized = mountNewMember({ query: { company_id: '7' }, caps: ['access.roles.read'] })
    expect(unauthorized.branchesEnabled).toBe(false)
    expect(unauthorized.rolesEnabled).toBe(false)

    const unknownBranch = mountNewMember({ query: { company_id: '99' }, branches: [{ id: 7, name: 'Jeddah' }] })
    expect(unknownBranch.branchesEnabled).toBe(true)
    expect(unknownBranch.rolesEnabled).toBe(false)
    expect(unknownBranch.state.pageError.value).toBeInstanceOf(RealApiError)
    expect(unknownBranch.state.pageError.value.status).toBe(404)

    const apiErr = new RealApiError(500, 'server_error', 'branches down')
    const failed = mountNewMember({ query: { company_id: '7' }, branches: null, branchError: apiErr })
    expect(failed.state.pageError.value).toBe(apiErr)
    failed.state.retry()
    expect(failed.refetchBranches).toHaveBeenCalledTimes(1)

    const valid = mountNewMember({ query: { company_id: '7' } })
    expect(valid.branchesEnabled).toBe(true)
    expect(valid.rolesEnabled).toBe(true)
    expect(valid.state.companyId.value).toBe(7)
    expect(valid.state.pageError.value).toBeNull()
  })

  it('members/[memberId]/edit.vue refuses invalid company_id without falling back to working company, gates queries, and surfaces API errors', () => {
    for (const invalid of ['abc', '0', '-3']) {
      const bad = mountEditMember({ query: { company_id: invalid } })
      expect(bad.state.invalidCompanyId.value).toBe(true)
      expect(bad.listEnabled).toBe(false)
      expect(bad.rolesEnabled).toBe(false)
      expect(bad.state.pageError.value).toBeInstanceOf(RealApiError)
      expect(bad.state.pageError.value.status).toBe(404)
    }

    const badMember = mountEditMember({ memberId: '0' })
    expect(badMember.listEnabled).toBe(false)
    expect(badMember.rolesEnabled).toBe(false)
    expect(badMember.state.pageError.value.status).toBe(404)

    const unauthorized = mountEditMember({ caps: ['access.users.grant'] })
    expect(unauthorized.listEnabled).toBe(false)
    expect(unauthorized.rolesEnabled).toBe(false)

    const apiErr = new RealApiError(503, 'unavailable', 'retry later')
    const failed = mountEditMember({ items: null, listError: apiErr })
    expect(failed.state.pageError.value).toBe(apiErr)
    failed.state.retry()
    expect(failed.refetchList).toHaveBeenCalledTimes(1)

    const workingCompany = mountEditMember({ memberId: '21', query: {} })
    expect(workingCompany.state.invalidCompanyId.value).toBe(false)
    expect(workingCompany.listCompany).toBeUndefined()
    expect(workingCompany.listEnabled).toBe(true)
    expect(workingCompany.rolesEnabled).toBe(true)
    expect(workingCompany.state.member.value?.id).toBe(21)
    expect(workingCompany.state.pageError.value).toBeNull()
  })
})
