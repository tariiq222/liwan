import {
  AcceptInvitationInputSchema,
  AccountLoginSchema,
  AccountTokenCheckSchema,
  ForgotPasswordInputSchema,
  InvitationAcceptedSchema,
  TokenPasswordResetInputSchema,
  type AcceptInvitationInput,
  type AccountTokenPurpose,
  type ForgotPasswordInput,
  type TokenPasswordResetInput,
} from '@liwan/contracts'
import { ApiError } from './useApi'

const PUBLIC_ACCOUNT = '/api/v1/public/account'

/** Why an emailed-link page could not finish: the link is gone, one field was refused, or the service did not answer. */
export type AccountLinkFailure = 'invalid_link' | 'weak_password' | 'invalid_mobile' | 'mobile_taken' | 'unavailable'

/**
 * Sorts a failed public call. A busy or unreachable service (no status, 429, 5xx) is `unavailable` and the page keeps what
 * the person typed; a refused field names itself; any other refusal means the link can no longer be used.
 */
export function accountLinkFailure(error: unknown): AccountLinkFailure {
  if (!(error instanceof ApiError)) return 'unavailable'
  if (error.status === 0 || error.status === 429 || error.status >= 500) return 'unavailable'
  if (error.code === 'weak_password' || error.code === 'invalid_mobile' || error.code === 'mobile_taken') return error.code
  return 'invalid_link'
}

/**
 * The anonymous account-link routes (emailed invitation and reset links). Each call is a plain request, never a
 * cached query: the bodies carry a token and a password and must not outlive the page. The token alone authorizes them.
 */
export function useAccountPublic() {
  const { $api } = useApi()
  return {
    /** Whether the link is still usable. The answer is only yes or no, whatever the reason. */
    async checkToken(token: string, purpose: AccountTokenPurpose): Promise<boolean> {
      const res = await $api(`${PUBLIC_ACCOUNT}/token`, { method: 'POST', body: { token, purpose }, schema: AccountTokenCheckSchema })
      return res.usable
    },
    /** Sets the holder's mobile number and password and signs them in; answers with the login. */
    async acceptInvitation(body: AcceptInvitationInput): Promise<string> {
      const input = AcceptInvitationInputSchema.parse(body)
      return (await $api(`${PUBLIC_ACCOUNT}/invitation/accept`, { method: 'POST', body: input, schema: InvitationAcceptedSchema })).login
    },
    /** Always answers the same way, whether or not an account has this email. */
    async requestPasswordReset(body: ForgotPasswordInput): Promise<void> {
      const input = ForgotPasswordInputSchema.parse(body)
      await $api(`${PUBLIC_ACCOUNT}/password/forgot`, { method: 'POST', body: input })
    },
    async resetPassword(body: TokenPasswordResetInput): Promise<string> {
      const input = TokenPasswordResetInputSchema.parse(body)
      return (await $api(`${PUBLIC_ACCOUNT}/password/reset`, { method: 'POST', body: input, schema: AccountLoginSchema })).login
    },
  }
}
