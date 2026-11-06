import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminUserKeys, useCancelAdminUserInvitation, useChangeAdminUserInvitationLogin, useDisableAdminUser, useGrantAdminAccount, useReactivateAdminUser, useResendAdminUserInvitation, useSendAdminUserResetLink } from '../useAdminUsers'
import { useGrantEmployeeAccount } from '../useEmployeeAccounts'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@tanstack/vue-query', async original => ({
  ...await original<object>(),
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => ({ ...(options as object), reset: () => {} }),
  useQueryClient: () => ({}),
}))

type Mutation<T> = { mutationFn: (variables: T) => Promise<unknown> }

function stubApi() {
  vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
  vi.stubGlobal('tryUseNuxtApp', () => null)
}
/** The contract's refusal arrives synchronously from the mutation function; TanStack turns it into a rejected mutation. */
const refused = <T>(mutation: Mutation<T>, variables: T) => (async () => mutation.mutationFn(variables))()
const VERSION = 'u18-a3-v7'
const ASSIGNMENTS = [{ role_id: 1, scope: { kind: 'company' as const, id: 1 } }]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('administrator invitation mutations', () => {
  it('invites with name, login and roles, and drops nothing into the body that the contract refuses', async () => {
    stubApi()
    const grant = useGrantAdminAccount() as unknown as Mutation<unknown>
    await grant.mutationFn({ name: 'سارة', login: 'sara@example.com', assignments: ASSIGNMENTS })
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/admin/users', expect.objectContaining({ method: 'POST', body: { name: 'سارة', login: 'sara@example.com', assignments: ASSIGNMENTS } }))
    await expect(refused(grant, { name: 'سارة', login: 'sara@example.com', password: 'twelve-chars!', assignments: ASSIGNMENTS })).rejects.toThrow()
    expect(mocks.api).toHaveBeenCalledTimes(1)
  })

  it('grants from an employee with the login the form chose', async () => {
    stubApi()
    const grant = useGrantEmployeeAccount() as unknown as Mutation<unknown>
    await grant.mutationFn({ employee_id: 31, login: 'sara@example.com', assignments: ASSIGNMENTS })
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/admin/employee-accounts', expect.objectContaining({ method: 'POST', body: { employee_id: 31, login: 'sara@example.com', assignments: ASSIGNMENTS } }))
    await expect(refused(grant, { employee_id: 31, assignments: ASSIGNMENTS })).rejects.toThrow()
  })

  it.each([
    ['resend', useResendAdminUserInvitation, '/api/v1/admin/users/7/invitation/resend'],
    ['cancel', useCancelAdminUserInvitation, '/api/v1/admin/users/7/invitation/cancel'],
    ['reset link', useSendAdminUserResetLink, '/api/v1/admin/users/7/reset-link'],
    ['disable', useDisableAdminUser, '/api/v1/admin/users/7/disable'],
    ['reactivate', useReactivateAdminUser, '/api/v1/admin/users/7/reactivate'],
  ])('%s posts the version and nothing else', async (_name, hook, url) => {
    stubApi()
    const mutation = hook() as unknown as Mutation<{ id: number; body: unknown }>
    await mutation.mutationFn({ id: 7, body: { expected_version: VERSION } })
    expect(mocks.api).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'POST', body: { expected_version: VERSION } }))
    await expect(refused(mutation, { id: 7, body: { expected_version: VERSION, password: 'twelve-chars!' } })).rejects.toThrow()
    await expect(refused(mutation, { id: 7, body: {} })).rejects.toThrow()
  })

  it('corrects the email of a pending invitation with a PATCH carrying the version', async () => {
    stubApi()
    const change = useChangeAdminUserInvitationLogin() as unknown as Mutation<{ id: number; body: unknown }>
    await change.mutationFn({ id: 7, body: { login: 'new@example.com', expected_version: VERSION } })
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/admin/users/7/invitation', expect.objectContaining({ method: 'PATCH', body: { login: 'new@example.com', expected_version: VERSION } }))
    await expect(refused(change, { id: 7, body: { login: 'not-an-email', expected_version: VERSION } })).rejects.toThrow()
  })

  it('keeps the seat count under the users cache so every account change refreshes it', () => {
    expect(adminUserKeys.seats.slice(0, 2)).toEqual(adminUserKeys.all)
  })
})
