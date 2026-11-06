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

/** Accepting an invitation or resetting a password answers with the login the person signs in with. */
export const AccountLoginSchema = z.object({ login: z.string() }).strict()
export type AccountLogin = z.infer<typeof AccountLoginSchema>

export const MobileInputSchema = z.object({ mobile: MobileSchema }).strict()
export type MobileInput = z.infer<typeof MobileInputSchema>
