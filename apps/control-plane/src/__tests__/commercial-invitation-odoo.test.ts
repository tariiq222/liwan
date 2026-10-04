import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { odooSetPassword } from '../commercial/invitation-odoo.js'
import { InvitationError } from '../commercial/invitations.js'

const input = () => ({ tenant_id: 'tenant-id', admin_login: 'admin@example.test', password: randomBytes(24).toString('base64url') })

describe('Odoo invitation password setter', () => {
  it('forwards accepted identity and password without returning credentials', async () => {
    const value = input()
    const setAdminPassword = vi.fn(async () => ({ login: value.admin_login, user_id: 2, changed_at: '2026-10-02T12:00:00Z' }))
    expect(await odooSetPassword({ setAdminPassword })(value)).toBeUndefined()
    expect(setAdminPassword.mock.calls.length).toBe(1)
    // Boolean checks keep test failure diagnostics secret-free.
    const actual = (setAdminPassword.mock.calls as unknown[][])[0][0] as typeof value
    expect(actual.tenant_id === value.tenant_id && actual.admin_login === value.admin_login && actual.password === value.password).toBe(true)
  })
  it.each(['user_missing', 'user_inactive', 'password_policy', 'database_invalid', 'script_failed'])('maps %s into a safe InvitationError', async code => {
    const setAdminPassword = async () => { throw Error(code) }
    const err = await odooSetPassword({ setAdminPassword })(input()).catch(e => e)
    expect(err).toBeInstanceOf(InvitationError)
    expect(err.code).toBe(code)
    expect(err.message).toBe(code)
  })
  it('refuses absent adapters explicitly', async () => {
    await expect(odooSetPassword({})(input())).rejects.toMatchObject({ code: 'password_setter_unavailable' })
  })
  it('scrubs arbitrary exception messages and protocol results', async () => {
    const value = input()
    for (const setAdminPassword of [async () => { throw Error(value.password) },
      async () => ({ login: value.admin_login, user_id: 1, changed_at: 'bad' }),
      async () => ({ login: value.admin_login, user_id: 2, changed_at: '2026-10-02T12:00:00Z', password: value.password })]) {
      const err = await odooSetPassword({ setAdminPassword })(value).catch(e => e)
      expect(err).toBeInstanceOf(InvitationError)
      expect(err.code).toBe('script_failed')
      expect(err.message.includes(value.password)).toBe(false)
    }
  })
  it('refuses mismatched admin receipts', async () => {
    const setAdminPassword = async () => ({ login: 'other@example.test', user_id: 2, changed_at: '2026-10-02T12:00:00Z' })
    await expect(odooSetPassword({ setAdminPassword })(input())).rejects.toMatchObject({ code: 'script_failed' })
  })
})
