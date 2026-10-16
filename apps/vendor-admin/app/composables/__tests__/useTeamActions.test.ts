import { describe, expect, it, vi } from 'vitest'
import { StepUpCancelled } from '../useStepUp'
import { createTeamActions } from '../useTeamActions'
import type { TeamAccount } from '../../utils/team'

const account: TeamAccount = { id: 7, email: 'w@x.test', display_name: 'Wafa', status: 'active', roles: ['support'], passkeys: 1, last_seen_at: null }

function setup(overrides: Partial<Record<'invite' | 'setRoles' | 'disable' | 'reset', unknown>> = {}) {
  const accounts = {
    list: vi.fn(),
    invite: vi.fn().mockResolvedValue({ token: 'secret-token', expiresAt: '2026-10-17T00:00:00.000Z' }),
    setRoles: vi.fn().mockResolvedValue(undefined),
    disable: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue({ token: 'fresh-token', expiresAt: '2026-10-17T00:00:00.000Z' }),
    ...overrides,
  } as unknown as Parameters<typeof createTeamActions>[0]['accounts']
  const changed = vi.fn()
  return { accounts, changed, team: createTeamActions({ accounts, origin: () => 'https://admin.example.test', changed }) }
}

describe('team actions', () => {
  it('sends the reason with an invitation and shows the link once', async () => {
    const { team, accounts, changed } = setup()
    await team.invite({ email: 'new@x.test', displayName: 'New', roles: ['finance'], reason: 'hiring' })
    expect(accounts.invite).toHaveBeenCalledWith({ email: 'new@x.test', displayName: 'New', roles: ['finance'], reason: 'hiring' })
    expect(team.invitation.value).toEqual({ name: 'New', link: 'https://admin.example.test/enroll#secret-token', expiresAt: '2026-10-17T00:00:00.000Z' })
    expect(changed).toHaveBeenCalledOnce()
    team.dismissInvitation()
    expect(team.invitation.value).toBeNull()
  })

  it('sends the reason with a role change, a disable and a reset', async () => {
    const { team, accounts } = setup()
    team.open({ kind: 'roles', account })
    await team.confirm('promotion', ['product', 'support'])
    expect(accounts.setRoles).toHaveBeenCalledWith(7, ['product', 'support'], 'promotion')
    expect(team.notice.value).toEqual({ key: 'team.roleEdit.saved', name: 'Wafa' })
    team.open({ kind: 'disable', account })
    await team.confirm('left the company')
    expect(accounts.disable).toHaveBeenCalledWith(7, 'left the company')
    team.open({ kind: 'reset', account })
    await team.confirm('lost device')
    expect(accounts.reset).toHaveBeenCalledWith(7, 'lost device')
    expect(team.invitation.value?.link).toBe('https://admin.example.test/enroll#fresh-token')
  })

  it('keeps the panel open and names the last owner when the disable is refused', async () => {
    const { team, changed } = setup({ disable: vi.fn().mockRejectedValue({ statusCode: 409, data: { code: 'last_owner' } }) })
    team.open({ kind: 'disable', account })
    await team.confirm('cleanup')
    expect(team.errorKey.value).toBe('team.errors.lastOwner')
    expect(team.panel.value).toMatchObject({ kind: 'disable' })
    expect(changed).not.toHaveBeenCalled()
  })

  it('shows the duplicate-email message and no link when the invitation is refused', async () => {
    const { team } = setup({ invite: vi.fn().mockRejectedValue({ statusCode: 409, data: { code: 'conflict' } }) })
    await team.invite({ email: 'dup@x.test', displayName: 'Dup', roles: ['support'], reason: 'again' })
    expect(team.errorKey.value).toBe('team.errors.conflict')
    expect(team.invitation.value).toBeNull()
  })

  it('reports a cancelled step-up without closing the panel', async () => {
    const { team } = setup({ disable: vi.fn().mockRejectedValue(new StepUpCancelled()) })
    team.open({ kind: 'disable', account })
    await team.confirm('cleanup')
    expect(team.errorKey.value).toBe('team.errors.stepUpCancelled')
    expect(team.panel.value).not.toBeNull()
  })

  it('sends one call at a time', async () => {
    let release!: () => void
    const { team, accounts } = setup({ disable: vi.fn(() => new Promise<void>((resolve) => { release = resolve })) })
    team.open({ kind: 'disable', account })
    const first = team.confirm('first')
    await team.confirm('second')
    release()
    await first
    expect(accounts.disable).toHaveBeenCalledOnce()
  })

  it('ignores a new panel while a call is running', async () => {
    let release!: () => void
    const { team } = setup({ disable: vi.fn(() => new Promise<void>((resolve) => { release = resolve })) })
    team.open({ kind: 'disable', account })
    const pending = team.confirm('first')
    team.open({ kind: 'roles', account })
    expect(team.panel.value).toMatchObject({ kind: 'disable' })
    release()
    await pending
  })

  it('clears an old failure when another panel opens', async () => {
    const { team } = setup({ disable: vi.fn().mockRejectedValue({ statusCode: 409, data: { code: 'last_owner' } }) })
    team.open({ kind: 'disable', account })
    await team.confirm('cleanup')
    team.open({ kind: 'roles', account })
    expect(team.errorKey.value).toBeNull()
  })
})
