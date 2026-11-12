import { resolve } from 'node:path'
import * as Vue from 'vue'
import { ExistingAccountDetailsSchema } from '@liwan/contracts'
import { describe, expect, it, vi } from 'vitest'
import { setupSfc, mutation } from '../../components/access/__tests__/sfcSetup'

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string, public details?: Record<string, unknown>) { super(message) }
}
const idle = () => ({ data: Vue.ref(undefined), isLoading: Vue.ref(false), error: Vue.ref(null) })
const EXISTING = { existing_account: { name: 'نورة', home_company: { id: 2, name: 'فرع الرياض' } } }

function dialog(over: { grant?: () => Promise<unknown>, grantEmployee?: () => Promise<unknown>, employeeId?: string, atSeatLimit?: boolean } = {}) {
  const add = vi.fn(async () => ({ id: 21, name: 'نورة' }))
  const { state } = setupSfc(resolve(import.meta.dirname, '../settings/team/users/new.vue'), {}, {
    ApiError, ExistingAccountDetailsSchema, ExistingAccountConfirm: {}, EmployeeAccountPicker: {}, RoleCheckboxes: {},
    owningListBack: () => '/settings/team/users', accessErrorMessage: (cause: ApiError) => `mapped:${cause.code}`, membershipErrorMessage: (cause: ApiError) => cause.code === 'not_found' ? 'access.members.emailNotFound' : `mapped:${cause.code}`, adminListQuery: () => ({}),
    useAccess: () => ({ can: () => true }), useMe: () => ({ me: Vue.ref({ company: { id: 1 } }) }),
    useRoute: () => ({ query: over.employeeId ? { employee_id: over.employeeId } : {}, hash: '' }), useRouter: () => ({ resolve: (to: string) => ({ fullPath: to }) }),
    useRecordListPaths: () => [], useEmployeeAccountBridge: () => ({ available: Vue.ref(true) }),
    useAdminRoles: () => ({ ...idle(), data: Vue.ref({ items: [] }) }), useAdminPermissionCatalog: idle, useAdminRoleDetails: idle, useAdminUser: idle,
    useAdminUserSeats: () => ({ data: Vue.ref(over.atSeatLimit ? { used: 5, limit: 5, read_only: 0 } : undefined) }),
    useGrantAdminAccount: () => mutation(over.grant ?? (async () => ({ id: 5, login: 'a@example.com' }))),
    useGrantEmployeeAccount: () => mutation(over.grantEmployee ?? (async () => ({ id: 6, login: 'e@example.com' }))),
    useReactivateAdminUser: () => mutation(vi.fn()), useUpdateAdminUserAccess: () => mutation(vi.fn()), useAddMembership: () => mutation(add),
  })
  return { state, add }
}
const exists = (details?: Record<string, unknown>) => async () => { throw new ApiError(409, 'account_exists', 'exists', 'login', details) }

describe('inviting an email that already has an account in another company', () => {
  it('shows the person and their home company, not a plain error, when the refusal carries the details', async () => {
    const { state } = dialog({ grant: exists(EXISTING) })
    state.name.value = 'نورة'
    state.login.value = 'noura@example.com'
    state.selectedRoleIds.value = [4]
    await state.submit()
    expect(state.existing.value).toEqual({ name: 'نورة', homeCompany: { id: 2, name: 'فرع الرياض' } })
    expect(state.errorKey.value).toBe('')
  })

  it('behaves as today without the details: the error text, no confirm step', async () => {
    for (const details of [undefined, {}, { existing_account: { name: 'x' } }]) {
      const { state, add } = dialog({ grant: exists(details) })
      state.name.value = 'نورة'
      state.login.value = 'noura@example.com'
      state.selectedRoleIds.value = [4]
      await state.submit()
      expect(state.existing.value).toBeNull()
      expect(state.errorKey.value).toBe('mapped:account_exists')
      expect(add).not.toHaveBeenCalled()
    }
  })

  it('adds the account with the roles already chosen and the typed email, then shows the result', async () => {
    const { state, add } = dialog({ grant: exists(EXISTING) })
    state.name.value = 'نورة'
    state.login.value = ' noura@example.com '
    state.selectedRoleIds.value = [4, 5]
    await state.submit()
    await state.confirmMembership()
    expect(add).toHaveBeenCalledWith({ login: 'noura@example.com', assignments: [{ role_id: 4, scope: { kind: 'company', id: 1 } }, { role_id: 5, scope: { kind: 'company', id: 1 } }] })
    expect(state.added.value).toEqual({ name: 'نورة' })
    expect(state.existing.value).toBeNull()
  })

  it('cancel returns to the form with what was typed', async () => {
    const { state, add } = dialog({ grant: exists(EXISTING) })
    state.name.value = 'نورة'
    state.login.value = 'noura@example.com'
    state.selectedRoleIds.value = [4]
    await state.submit()
    state.declineMembership()
    expect(state.existing.value).toBeNull()
    expect(state.login.value).toBe('noura@example.com')
    expect(state.selectedRoleIds.value).toEqual([4])
    expect(add).not.toHaveBeenCalled()
  })

  it('shows a refused add on the confirm step and keeps it open', async () => {
    const { state, add } = dialog({ grant: exists(EXISTING) })
    add.mockRejectedValueOnce(new ApiError(409, 'already_member', 'member'))
    state.name.value = 'نورة'
    state.login.value = 'noura@example.com'
    state.selectedRoleIds.value = [4]
    await state.submit()
    await state.confirmMembership()
    expect(state.membershipError.value).toBe('mapped:already_member')
    expect(state.existing.value).not.toBeNull()
  })
})

describe('inviting at the seat limit', () => {
  const fill = (state: any) => {
    state.name.value = 'نورة'
    state.login.value = 'noura@example.com'
    state.selectedRoleIds.value = [4]
  }
  it('still sends the request, so an existing account of the organisation (which takes no seat) reaches the confirm step', async () => {
    const { state } = dialog({ atSeatLimit: true, grant: exists(EXISTING) })
    expect(state.atSeatLimit.value).toBe(true)
    fill(state)
    await state.submit()
    expect(state.existing.value).not.toBeNull()
  })

  it('shows the server\'s seat-limit refusal for a new account', async () => {
    const { state } = dialog({ atSeatLimit: true, grant: async () => { throw new ApiError(403, 'feature_not_included', 'Your plan limit was reached', undefined, { reason: 'limit', limit_key: 'users.limit' }) } })
    fill(state)
    await state.submit()
    expect(state.existing.value).toBeNull()
    expect(state.errorKey.value).toBe('mapped:feature_not_included')
  })
})

describe('the confirm step\'s refusals', () => {
  it('say the same thing as the add form when the email cannot be added', async () => {
    const { state, add } = dialog({ grant: exists(EXISTING) })
    add.mockRejectedValueOnce(new ApiError(404, 'not_found', 'x'))
    state.name.value = 'نورة'
    state.login.value = 'noura@example.com'
    state.selectedRoleIds.value = [4]
    await state.submit()
    await state.confirmMembership()
    expect(state.membershipError.value).toBe('access.members.emailNotFound')
  })
})

describe('giving an employee an account whose email already has one', () => {
  it('adds the account and links that employee', async () => {
    const { state, add } = dialog({ employeeId: '12', grantEmployee: exists(EXISTING) })
    state.selectedCandidate.value = { id: 12, user_id: null, access_active: null, work_email: 'e@example.com' }
    state.login.value = 'noura@example.com'
    state.selectedRoleIds.value = [4]
    await state.submit()
    expect(state.existing.value).not.toBeNull()
    await state.confirmMembership()
    expect(add).toHaveBeenCalledWith({ login: 'noura@example.com', assignments: [{ role_id: 4, scope: { kind: 'company', id: 1 } }], employee_id: 12 })
  })
})
