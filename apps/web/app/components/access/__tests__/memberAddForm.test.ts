import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { setupSfc, mutation } from './sfcSetup'

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

function form(add: (...args: any[]) => Promise<unknown>) {
  const { state, emit } = setupSfc(resolve(import.meta.dirname, '../users/MemberAddForm.vue'), { companyId: 7, roles: [] }, {
    ApiError, RoleCheckboxes: {}, accessErrorMessage: (cause: Error) => `mapped:${cause.message}`, useAddMembership: () => mutation(add),
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
    const missing = form(async () => { throw new ApiError(404, 'not_found', 'x') })
    missing.state.login.value = 'a@example.com'
    missing.state.roleIds.value = [4]
    await missing.state.submit()
    expect(missing.state.error.value).toBe('access.members.emailNotFound')
    const other = form(async () => { throw new ApiError(409, 'already_member', 'already') })
    other.state.login.value = 'a@example.com'
    other.state.roleIds.value = [4]
    await other.state.submit()
    expect(other.state.error.value).toBe('mapped:already')
  })
})
