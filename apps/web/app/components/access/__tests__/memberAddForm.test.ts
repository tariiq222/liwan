import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { ApiError as RealApiError } from '../../../composables/useApi'
import { membershipErrorMessage } from '../../../utils/accessErrors'
import { setupSfc, mutation } from './sfcSetup'

function form(add: (...args: any[]) => Promise<unknown>) {
  const { state, emit } = setupSfc(resolve(import.meta.dirname, '../users/MemberAddForm.vue'), { companyId: 7, roles: [] }, {
    ApiError: RealApiError, RoleCheckboxes: {}, membershipErrorMessage, useAddMembership: () => mutation(add),
  })
  return { state, emit }
}

describe('adding a member to a branch', () => {
  it('sends the typed email and the chosen roles of the branch, and names the branch', async () => {
    const add = vi.fn(async () => ({ name: 'Noura' }))
    const { state, emit } = form(add)
    state.login.value = ' noura@example.com '
    state.roleIds.value = [4]
    await state.submit()
    expect(add).toHaveBeenCalledWith({ login: 'noura@example.com', assignments: [{ role_id: 4, scope: { kind: 'company', id: 7 } }], company_id: 7 })
    expect(emit).toHaveBeenCalledWith('added', 'Noura')
    expect(state.login.value).toBe('')
  })

  it('needs an email and at least one role', async () => {
    const add = vi.fn()
    const { state } = form(add)
    await state.submit()
    state.login.value = 'noura@example.com'
    await state.submit()
    expect(add).not.toHaveBeenCalled()
  })

  it('shows one message for every email that cannot be added, and the mapped text for other refusals', async () => {
    const missing = form(async () => { throw new RealApiError(404, 'not_found', 'x') })
    missing.state.login.value = 'a@example.com'
    missing.state.roleIds.value = [4]
    await missing.state.submit()
    expect(missing.state.error.value).toBe('access.members.emailNotFound')
    const other = form(async () => { throw new RealApiError(409, 'already_member', 'already') })
    other.state.login.value = 'a@example.com'
    other.state.roleIds.value = [4]
    await other.state.submit()
    expect(other.state.error.value).toBe('access.errors.conflict')
  })

  it('shows the self-grant policy text when the caller adds their own account with roles beyond it', async () => {
    const t = (key: string) => key === 'access.errors.self_grant_restricted' ? 'policy text' : key
    const refused = new RealApiError(403, 'self_grant_restricted', 'raw', 'assignments', { roles: ['payroll'], permissions: ['payroll.manage'] })
    const { state } = setupSfc(resolve(import.meta.dirname, '../users/MemberAddForm.vue'), { companyId: 7, roles: [] }, {
      ApiError: RealApiError, RoleCheckboxes: {}, membershipErrorMessage, useAddMembership: () => mutation(async () => { throw refused }),
      useI18n: () => ({ t, locale: Vue.ref('en') }),
    })
    state.login.value = 'me@example.com'
    state.roleIds.value = [4]
    await state.submit()
    expect(state.error.value).toBe('policy text')
  })
})
