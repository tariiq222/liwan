import { sortedRoles, type TeamAccount, type TeamInvitation, type TeamRole } from '../utils/team'

type Request = <T>(path: string, options?: { method?: string, body?: unknown }) => Promise<T>

interface InvitationBody { invitation_token: string, expires_at: string }

const invitationOf = (body: InvitationBody): TeamInvitation => ({ token: body.invitation_token, expiresAt: body.expires_at })

/** The account-management calls. Every mutation carries the reason the audit trail records. */
export function createAdminAccounts(request: Request) {
  const post = <T>(path: string, body: object) => request<T>(path, { method: 'POST', body })
  return {
    async list(): Promise<{ items: TeamAccount[], total: number }> {
      const page = await request<{ items: TeamAccount[], total: number }>('admin/accounts')
      return { total: page.total, items: page.items.map(account => ({ ...account, roles: sortedRoles(account.roles) })) }
    },
    async invite(input: { email: string, displayName: string, roles: TeamRole[], reason: string }): Promise<TeamInvitation> {
      const created = await post<InvitationBody>('admin/accounts', { email: input.email.trim(), display_name: input.displayName.trim(), roles: input.roles, reason: input.reason.trim() })
      return invitationOf(created)
    },
    setRoles: (id: number, roles: TeamRole[], reason: string): Promise<void> => post<void>(`admin/accounts/${id}/roles`, { roles, reason: reason.trim() }),
    disable: (id: number, reason: string): Promise<void> => post<void>(`admin/accounts/${id}/disable`, { reason: reason.trim() }),
    async reset(id: number, reason: string): Promise<TeamInvitation> {
      return invitationOf(await post<InvitationBody>(`admin/accounts/${id}/reset`, { reason: reason.trim() }))
    },
  }
}

export function useAdminAccounts() {
  return createAdminAccounts(useVendorApi().request)
}
