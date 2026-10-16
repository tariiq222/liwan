import { describe, expect, it, vi } from 'vitest'
import { takeInvitationToken } from '../invitationToken'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'

function page(hash: string) {
  const history = { state: { position: 3 }, replaceState: vi.fn() }
  return { history, location: { hash, pathname: '/enroll', search: '' } }
}

describe('takeInvitationToken', () => {
  it('returns the 43-character token and removes the fragment from the address', () => {
    const { history, location } = page(`#${TOKEN}`)
    expect(takeInvitationToken(location, history)).toBe(TOKEN)
    expect(history.replaceState).toHaveBeenCalledWith({ position: 3 }, '', '/enroll')
  })

  it('removes the fragment even when it is not a token', () => {
    const { history, location } = page('#short')
    expect(takeInvitationToken(location, history)).toBeNull()
    expect(history.replaceState).toHaveBeenCalledTimes(1)
  })

  it('returns null for an address without a fragment', () => {
    const { history, location } = page('')
    expect(takeInvitationToken(location, history)).toBeNull()
  })

  it('keeps the query string', () => {
    const history = { state: null, replaceState: vi.fn() }
    takeInvitationToken({ hash: `#${TOKEN}`, pathname: '/enroll', search: '?lang=en' }, history)
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/enroll?lang=en')
  })
})
