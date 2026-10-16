import { ref } from 'vue'
import { invitationLink, teamErrorKey, type TeamAccount, type TeamRole } from '../utils/team'
import { useAdminAccounts, type createAdminAccounts } from './useAdminAccounts'

type Accounts = ReturnType<typeof createAdminAccounts>

export type TeamPanel =
  | { kind: 'invite' }
  | { kind: 'roles' | 'disable' | 'reset', account: TeamAccount }

export interface InviteDraft { email: string, displayName: string, roles: TeamRole[], reason: string }

/** The enrollment link of one invitation. It lives in this object only, until the person dismisses it. */
export interface ShownInvitation { name: string, link: string, expiresAt: string }

export interface TeamNotice { key: string, name: string }

export interface TeamActionsDeps {
  accounts: Accounts
  /** The address the invitation link points at (the app's own origin). */
  origin: () => string
  /** Called after a change the list must show. */
  changed: () => unknown
}

/** What the team page is doing now: the open panel, the one pending call, its failure and the link shown once. */
export function createTeamActions({ accounts, origin, changed }: TeamActionsDeps) {
  const panel = ref<TeamPanel | null>(null)
  const busy = ref(false)
  const errorKey = ref<string | null>(null)
  const notice = ref<TeamNotice | null>(null)
  const invitation = ref<ShownInvitation | null>(null)

  function open(next: TeamPanel) {
    panel.value = next
    errorKey.value = null
    notice.value = null
  }
  function close() {
    panel.value = null
    errorKey.value = null
  }
  function dismissInvitation() {
    invitation.value = null
  }

  /** Runs one mutation; a failure keeps the panel open with its message, success closes it. */
  async function perform(call: () => Promise<void>): Promise<void> {
    if (busy.value) return
    busy.value = true
    errorKey.value = null
    try {
      await call()
      panel.value = null
      await changed()
    } catch (error) {
      errorKey.value = teamErrorKey(error)
    } finally {
      busy.value = false
    }
  }

  const show = (name: string, shown: { token: string, expiresAt: string }) => {
    invitation.value = { name, link: invitationLink(origin(), shown.token), expiresAt: shown.expiresAt }
  }

  function invite(draft: InviteDraft): Promise<void> {
    return perform(async () => {
      show(draft.displayName.trim(), await accounts.invite(draft))
      notice.value = null
    })
  }

  /** Confirms the open role, disable or reset panel with the reason (and the chosen roles, for roles). */
  function confirm(reason: string, roles: TeamRole[] = []): Promise<void> {
    const current = panel.value
    if (!current || current.kind === 'invite') return Promise.resolve()
    const { account } = current
    const name = account.display_name
    return perform(async () => {
      if (current.kind === 'roles') {
        await accounts.setRoles(account.id, roles, reason)
        notice.value = { key: 'team.roleEdit.saved', name }
      } else if (current.kind === 'disable') {
        await accounts.disable(account.id, reason)
        notice.value = { key: 'team.disable.done', name }
      } else {
        show(name, await accounts.reset(account.id, reason))
        notice.value = null
      }
    })
  }

  return { panel, busy, errorKey, notice, invitation, open, close, dismissInvitation, invite, confirm }
}

export function useTeamActions(changed: () => unknown) {
  return createTeamActions({ accounts: useAdminAccounts(), origin: () => window.location.origin, changed })
}
