import { describe, expect, it, vi } from 'vitest'
import { createAdminAccounts } from '../useAdminAccounts'

function setup(answer: unknown = undefined) {
  const request = vi.fn().mockResolvedValue(answer)
  return { request, api: createAdminAccounts(request) }
}

describe('admin accounts calls', () => {
  it('lists accounts with roles in canonical order', async () => {
    const { api, request } = setup({ total: 1, items: [{ id: 1, email: 'a@x.test', display_name: 'A', status: 'active', roles: ['support', 'owner'], passkeys: 1, last_seen_at: null }] })
    const page = await api.list()
    expect(request).toHaveBeenCalledWith('admin/accounts')
    expect(page.items[0]!.roles).toEqual(['owner', 'support'])
  })

  it('sends the reason with an invitation and returns the token and expiry', async () => {
    const { api, request } = setup({ id: 2, invitation_token: 'tok', expires_at: '2026-10-17T00:00:00.000Z' })
    const invitation = await api.invite({ email: ' New@x.test ', displayName: ' New ', roles: ['finance'], reason: ' hiring ' })
    expect(request).toHaveBeenCalledWith('admin/accounts', { method: 'POST', body: { email: 'New@x.test', display_name: 'New', roles: ['finance'], reason: 'hiring' } })
    expect(invitation).toEqual({ token: 'tok', expiresAt: '2026-10-17T00:00:00.000Z' })
  })

  it('sends the reason with every mutation', async () => {
    const { api, request } = setup()
    await api.setRoles(7, ['product'], 'promotion')
    await api.disable(7, 'left the company')
    expect(request).toHaveBeenCalledWith('admin/accounts/7/roles', { method: 'POST', body: { roles: ['product'], reason: 'promotion' } })
    expect(request).toHaveBeenCalledWith('admin/accounts/7/disable', { method: 'POST', body: { reason: 'left the company' } })
  })

  it('returns the new enrollment link material of a reset', async () => {
    const { api, request } = setup({ invitation_token: 'again', expires_at: '2026-10-17T00:00:00.000Z' })
    expect(await api.reset(7, 'lost device')).toEqual({ token: 'again', expiresAt: '2026-10-17T00:00:00.000Z' })
    expect(request).toHaveBeenCalledWith('admin/accounts/7/reset', { method: 'POST', body: { reason: 'lost device' } })
  })
})
