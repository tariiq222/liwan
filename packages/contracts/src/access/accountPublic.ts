import { z } from 'zod'
import { MobileSchema, PasswordInputSchema } from './access'

// The anonymous account-link routes (`/api/v1/public/account/*`): authorized by the emailed token alone.
export const AccountTokenPurposeSchema = z.enum(['invite', 'reset'])
export type AccountTokenPurpose = z.infer<typeof AccountTokenPurposeSchema>

const TokenSchema = z.string().trim().min(1)

export const AccountTokenCheckInputSchema = z.object({ token: TokenSchema, purpose: AccountTokenPurposeSchema }).strict()
export type AccountTokenCheckInput = z.infer<typeof AccountTokenCheckInputSchema>
export const AccountTokenCheckSchema = z.object({ usable: z.boolean() }).strict()

export const AcceptInvitationInputSchema = z.object({ token: TokenSchema, mobile: MobileSchema, password: PasswordInputSchema }).strict()
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationInputSchema>

export const ForgotPasswordInputSchema = z.object({ email: z.string().trim().email() }).strict()
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInputSchema>

export const TokenPasswordResetInputSchema = z.object({ token: TokenSchema, password: PasswordInputSchema }).strict()
export type TokenPasswordResetInput = z.infer<typeof TokenPasswordResetInputSchema>

/** Resetting a password answers with the login the person signs in with. */
export const AccountLoginSchema = z.object({ login: z.string() }).strict()
export type AccountLogin = z.infer<typeof AccountLoginSchema>

/** Accepting an invitation also reports whether the account came out read-only because no full seat was free. */
export const InvitationAcceptedSchema = z.object({ login: z.string(), read_only: z.boolean() }).strict()
export type InvitationAccepted = z.infer<typeof InvitationAcceptedSchema>

export const MobileInputSchema = z.object({ mobile: MobileSchema }).strict()
export type MobileInput = z.infer<typeof MobileInputSchema>
