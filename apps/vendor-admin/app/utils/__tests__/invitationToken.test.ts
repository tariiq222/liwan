import { describe, expect, it, vi } from 'vitest'
import { takeInvitationToken } from '../invitationToken'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'

describe('takeInvitationToken', () => {
  it('returns the 43-character token after the fragment has been cleared through the router', async () => {
    const events: string[] = []
    const clear = vi.fn(async () => { events.push('cleared') })
    const token = await takeInvitationToken(`#${TOKEN}`, clear)
    events.push('returned')
    expect(token).toBe(TOKEN)
    expect(events).toEqual(['cleared', 'returned'])
  })

  it('clears the fragment even when it is not a token', async () => {
    const clear = vi.fn(async () => undefined)
    expect(await takeInvitationToken('#short', clear)).toBeNull()
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('does not navigate when there is no fragment', async () => {
    const clear = vi.fn(async () => undefined)
    expect(await takeInvitationToken('', clear)).toBeNull()
    expect(clear).not.toHaveBeenCalled()
  })
})
