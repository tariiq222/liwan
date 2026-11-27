import { z } from 'zod'
import { TelephonyCollectionSchema, TelephonyIdSchema, TelephonyNumberSchema } from './shared'

/**
 * The line is how a company's calls reach the outside world, and how they arrive (design section 5). `kind` says what
 * the line is, `mode` how the connection works (`a`: Liwan connects to the provider; `b`: a gateway device registers
 * to Liwan), and `authMethod` how the provider authenticates this host (`ip` by allowlisted address, `credentials` by
 * username and password).
 */
export const TelephonyLineKindSchema = z.enum(['sip_trunk', 'analog_gateway', 'mobile_gateway'])
export const TelephonyLineModeSchema = z.enum(['a', 'b'])
export const TelephonyLineAuthMethodSchema = z.enum(['ip', 'credentials'])

// A provider host is a lower or mixed case host name or an IPv4 address: letters, digits, dots and inner hyphens.
const ProviderHostSchema = z.string().min(1).max(253)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/, 'a host name or IPv4 address')

/**
 * A company line as `dump_line` serializes it. No provider password is stored or returned, so this shape has no
 * password field and must never grow one.
 */
export const TelephonyLineSchema = z.strictObject({
  id: TelephonyIdSchema,
  name: z.string().min(1).max(120),
  kind: TelephonyLineKindSchema,
  mode: TelephonyLineModeSchema,
  authMethod: TelephonyLineAuthMethodSchema,
  providerHost: ProviderHostSchema.nullable(),
  providerPort: z.number().int().min(1).max(65535),
  // The numbers the provider assigned to the company, in E.164.
  numbers: z.array(TelephonyNumberSchema),
  // Digits the provider requires before every dialled number; null when it wants the number as dialled.
  outboundFormat: z.string().regex(/^\d{1,10}$/).nullable(),
  callerId: TelephonyNumberSchema.nullable(),
  maxConcurrent: z.number().int().min(1).max(1000),
})

export const TelephonyLineListSchema = TelephonyCollectionSchema(TelephonyLineSchema)

export type TelephonyLineKind = z.infer<typeof TelephonyLineKindSchema>
export type TelephonyLineMode = z.infer<typeof TelephonyLineModeSchema>
export type TelephonyLineAuthMethod = z.infer<typeof TelephonyLineAuthMethodSchema>
export type TelephonyLine = z.infer<typeof TelephonyLineSchema>
export type TelephonyLineList = z.infer<typeof TelephonyLineListSchema>
