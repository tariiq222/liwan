import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../useApi'
import { accountLinkFailure, useAccountPublic } from '../useAccountPublic'

const api = vi.fn()

function account() {
  vi.stubGlobal('useApi', () => ({ $api: api }))
  return useAccountPublic()
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('useAccountPublic', () => {
  it('checks a link for one purpose and answers only yes or no', async () => {
    api.mockResolvedValue({ usable: true })
    expect(await account().checkToken('tok', 'invite')).toBe(true)
    expect(api).toHaveBeenCalledWith('/api/v1/public/account/token', expect.objectContaining({ method: 'POST', body: { token: 'tok', purpose: 'invite' } }))
    api.mockResolvedValue({ usable: false })
    expect(await account().checkToken('tok', 'reset')).toBe(false)
  })

  it('accepts an invitation with the mobile number and password, and returns the login', async () => {
    api.mockResolvedValue({ login: 'sara@example.com', read_only: false })
    const login = await account().acceptInvitation({ token: 'tok', mobile: '+966500000001', password: 'twelve-chars!' })
    expect(login).toBe('sara@example.com')
    expect(api).toHaveBeenCalledWith('/api/v1/public/account/invitation/accept', expect.objectContaining({ method: 'POST', body: { token: 'tok', mobile: '+966500000001', password: 'twelve-chars!' } }))
  })

  it('refuses a short password or a malformed mobile before any request', async () => {
    await expect(account().acceptInvitation({ token: 'tok', mobile: '+966500000001', password: 'short' })).rejects.toThrow()
    await expect(account().acceptInvitation({ token: 'tok', mobile: '0500000001', password: 'twelve-chars!' })).rejects.toThrow()
    await expect(account().resetPassword({ token: 'tok', password: 'short' })).rejects.toThrow()
    await expect(account().requestPasswordReset({ email: 'nope' })).rejects.toThrow()
    expect(api).not.toHaveBeenCalled()
  })

  it('asks for a reset link with the email alone, and resets with the token and password alone', async () => {
    api.mockResolvedValue({})
    await account().requestPasswordReset({ email: 'sara@example.com' })
    expect(api).toHaveBeenCalledWith('/api/v1/public/account/password/forgot', expect.objectContaining({ method: 'POST', body: { email: 'sara@example.com' } }))
    api.mockResolvedValue({ login: 'sara@example.com' })
    expect(await account().resetPassword({ token: 'tok', password: 'twelve-chars!' })).toBe('sara@example.com')
    expect(api).toHaveBeenLastCalledWith('/api/v1/public/account/password/reset', expect.objectContaining({ method: 'POST', body: { token: 'tok', password: 'twelve-chars!' } }))
  })
})

describe('accountLinkFailure', () => {
  it('keeps the form for a busy or unreachable service', () => {
    expect(accountLinkFailure(new ApiError(0, 'http_error', 'offline'))).toBe('unavailable')
    expect(accountLinkFailure(new ApiError(429, 'rate_limited', 'busy'))).toBe('unavailable')
    expect(accountLinkFailure(new ApiError(503, 'unavailable', 'down'))).toBe('unavailable')
    expect(accountLinkFailure(new Error('boom'))).toBe('unavailable')
  })

  it('names a refused field', () => {
    expect(accountLinkFailure(new ApiError(422, 'weak_password', 'short', 'password'))).toBe('weak_password')
    expect(accountLinkFailure(new ApiError(422, 'invalid_mobile', 'bad', 'mobile'))).toBe('invalid_mobile')
    expect(accountLinkFailure(new ApiError(409, 'mobile_taken', 'taken', 'mobile'))).toBe('mobile_taken')
  })

  it('treats every other refusal as a link that can no longer be used', () => {
    expect(accountLinkFailure(new ApiError(404, 'invalid_token', 'gone'))).toBe('invalid_link')
    expect(accountLinkFailure(new ApiError(422, 'invalid', 'bad body'))).toBe('invalid_link')
  })
})
