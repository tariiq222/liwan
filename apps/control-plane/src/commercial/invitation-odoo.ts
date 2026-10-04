import { InvitationError, type SetPassword } from './invitations.js'

/** Password input is ephemeral: implementations must send it through stdin only. */
export interface OdooPasswordAdapter {
  setAdminPassword?: (input: Parameters<SetPassword>[0]) => Promise<unknown>
}

const codes = new Set(['user_missing', 'user_inactive', 'password_policy', 'database_invalid', 'script_failed'])

/** Bridge an accepted invitation to the provisioned tenant admin; never expose
 * arbitrary runtime exception text (which could include passwords or tokens). */
export function odooSetPassword(adapter: OdooPasswordAdapter): SetPassword {
  return async input => {
    if (!adapter.setAdminPassword) throw new InvitationError('password_setter_unavailable')
    try {
      const value = await adapter.setAdminPassword(input)
      if (!value || typeof value !== 'object') throw Error('script_failed')
      const result = value as Record<string, unknown>
      if (Object.keys(result).sort().join(',') !== 'changed_at,login,user_id' || result.login !== input.admin_login ||
        !Number.isSafeInteger(result.user_id) || Number(result.user_id) <= 1 || typeof result.changed_at !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(result.changed_at) || !Number.isFinite(Date.parse(result.changed_at))) {
        throw Error('script_failed')
      }
    } catch (e) {
      const code = e instanceof Error && codes.has(e.message) ? e.message : 'script_failed'
      throw new InvitationError(code)
    }
  }
}
