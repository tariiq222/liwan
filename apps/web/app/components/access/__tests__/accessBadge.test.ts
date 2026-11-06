import { describe, expect, it } from 'vitest'
import { accessBadge } from '../accessBadge'

describe('accessBadge', () => {
  it('shows protected as a locked info badge, never the success tone', () => {
    expect(accessBadge({ active: true, protected: true })).toMatchObject({ tone: 'info', labelKey: 'access.protected', icon: 'i-lucide-lock' })
  })
  it('keeps the shared map for the other states', () => {
    expect(accessBadge({ active: true })).toMatchObject({ tone: 'success', labelKey: 'access.active' })
    expect(accessBadge({ active: false })).toMatchObject({ tone: 'warning', labelKey: 'access.disabled' })
  })
})

describe('accessBadge for invitations', () => {
  const invitation = (state: 'pending' | 'expired', delivery: 'pending' | 'sent' | 'failed') => ({ state, delivery, sent_at: '2026-11-06T10:00:00', expires_at: '2026-11-09T10:00:00' })
  it('shows a pending account as waiting for acceptance, not active', () => {
    expect(accessBadge({ active: true, invitation: invitation('pending', 'sent') })).toMatchObject({ labelKey: 'access.users.invitationState.pending' })
    expect(accessBadge({ active: true, invitation: invitation('pending', 'pending') })).toMatchObject({ labelKey: 'access.users.invitationState.pending' })
  })
  it('shows an expired link, and a mail that did not go out over the clock', () => {
    expect(accessBadge({ active: true, invitation: invitation('expired', 'sent') })).toMatchObject({ tone: 'warning', labelKey: 'access.users.invitationState.expired' })
    expect(accessBadge({ active: true, invitation: invitation('pending', 'failed') })).toMatchObject({ tone: 'destructive', labelKey: 'access.users.invitationState.failed' })
    expect(accessBadge({ active: true, invitation: invitation('expired', 'failed') })).toMatchObject({ labelKey: 'access.users.invitationState.failed' })
  })
  it('falls back to the account state once there is no invitation, and for archived or protected accounts', () => {
    expect(accessBadge({ active: true, invitation: null })).toMatchObject({ labelKey: 'access.active' })
    expect(accessBadge({ active: true, invitation: { state: null, delivery: null, sent_at: null, expires_at: null } })).toMatchObject({ labelKey: 'access.active' })
    expect(accessBadge({ active: false, invitation: invitation('pending', 'sent') })).toMatchObject({ labelKey: 'access.disabled' })
    expect(accessBadge({ active: true, protected: true, invitation: invitation('pending', 'sent') })).toMatchObject({ labelKey: 'access.protected', icon: 'i-lucide-lock' })
  })
})
