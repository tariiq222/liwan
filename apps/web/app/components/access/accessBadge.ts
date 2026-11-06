import type { AdminUserInvitation } from '@liwan/contracts'
import { accessStateBadge } from '../../utils/accessStateBadge'
import type { StatusBadgeEntry } from '@liwan/ui/app/utils/statusBadge'

interface AccessBadge extends StatusBadgeEntry {
  icon?: string
}

export type InvitationStatus = 'pending' | 'expired' | 'failed'

/** What a pending invitation shows: a mail that never went out outranks the clock, and an expired link outranks waiting. */
export function invitationStatus(invitation: AdminUserInvitation | null | undefined): InvitationStatus | null {
  if (!invitation) return null
  if (invitation.delivery === 'failed') return 'failed'
  return invitation.state
}

const INVITATION_BADGES: Record<InvitationStatus, AccessBadge> = {
  pending: { tone: 'info', labelKey: 'access.users.invitationState.pending', icon: 'i-lucide-mail' },
  expired: { tone: 'warning', labelKey: 'access.users.invitationState.expired', icon: 'i-lucide-clock-alert' },
  failed: { tone: 'destructive', labelKey: 'access.users.invitationState.failed', icon: 'i-lucide-mail-warning' },
}

/**
 * Protected accounts and roles are locked, not "successful": an info badge with a lock, never the green active tone.
 * An account whose holder has not accepted yet shows its invitation instead of "active".
 */
export function accessBadge(row: { active: boolean; protected?: boolean; readOnly?: boolean; invitation?: AdminUserInvitation | null }): AccessBadge {
  const entry = accessStateBadge(row)
  if (row.protected) return { ...entry, tone: 'info', icon: 'i-lucide-lock' }
  const status = row.active ? invitationStatus(row.invitation) : null
  return status ? INVITATION_BADGES[status] : entry
}
