import { z } from 'zod'
import { TelephonyCollectionSchema, TelephonyIdSchema, TelephonyRefSchema } from './shared'

/** The extension digits a browser registers with, for example 1001. */
export const TelephonyExtensionNumberSchema = z.string().regex(/^\d{2,10}$/)

/**
 * One softphone extension. A SIP password never travels on the wire: the session route hands it to the browser and
 * Asterisk keeps it, so the contract has no field for it on purpose.
 */
export const TelephonyExtensionSchema = z.strictObject({
  id: TelephonyIdSchema,
  number: TelephonyExtensionNumberSchema,
  user: TelephonyRefSchema,
  active: z.boolean(),
})

export const TelephonyExtensionListSchema = TelephonyCollectionSchema(TelephonyExtensionSchema)

export type TelephonyExtension = z.infer<typeof TelephonyExtensionSchema>
export type TelephonyExtensionList = z.infer<typeof TelephonyExtensionListSchema>
