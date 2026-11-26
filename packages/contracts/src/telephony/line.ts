import { z } from 'zod'
import { TelephonyCollectionSchema, TelephonyIdSchema, TelephonyNumberSchema } from './shared'

/**
 * The line is the company's own provider trunk (design D4). `kind` says what the line is, `mode` how the package is
 * reached (mode a: the provider dials the package over its public SIP port; mode b: devices register into Liwan), and
 * `authMethod` how the provider authenticates this host (`ip` by address, `credentials` by username and password).
 */
export const TelephonyLineKindSchema = z.enum(['trunk', 'device'])
export const TelephonyLineModeSchema = z.enum(['mode_a', 'mode_b'])
export const TelephonyLineAuthMethodSchema = z.enum(['ip', 'credentials'])
/** What Asterisk reports of the line's endpoint: registered, usable, or neither. */
export const TelephonyLineStateSchema = z.enum(['registered', 'available', 'unavailable'])

const HostSchema = z.string().min(1).max(253)
  .regex(/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/,
    'a lowercase host name')

/**
 * A company line as the settings screen reads it back. The provider password is written once and passed to pbx-agent;
 * it is never returned, so this shape has no password field and must never grow one.
 */
export const TelephonyLineSchema = z.strictObject({
  id: TelephonyIdSchema,
  name: z.string().min(1).max(120),
  kind: TelephonyLineKindSchema,
  mode: TelephonyLineModeSchema,
  authMethod: TelephonyLineAuthMethodSchema,
  provider: z.strictObject({
    host: HostSchema,
    port: z.number().int().min(1).max(65535),
  }),
  // The numbers the provider assigned to the company, in E.164.
  numbers: z.array(TelephonyNumberSchema),
  // Digits the provider requires before every dialled number; empty when it wants the number as dialled.
  outboundFormat: z.string().regex(/^\d{0,10}$/),
  callerId: TelephonyNumberSchema,
  maxConcurrent: z.number().int().min(1).max(1000),
  state: TelephonyLineStateSchema,
})

export const TelephonyLineListSchema = TelephonyCollectionSchema(TelephonyLineSchema)

export type TelephonyLineKind = z.infer<typeof TelephonyLineKindSchema>
export type TelephonyLineMode = z.infer<typeof TelephonyLineModeSchema>
export type TelephonyLineAuthMethod = z.infer<typeof TelephonyLineAuthMethodSchema>
export type TelephonyLineState = z.infer<typeof TelephonyLineStateSchema>
export type TelephonyLine = z.infer<typeof TelephonyLineSchema>
export type TelephonyLineList = z.infer<typeof TelephonyLineListSchema>
