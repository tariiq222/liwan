import { z } from 'zod'
import { TelephonyCallSchema } from './call'
import { TelephonyIdSchema, TelephonyNumberSchema, TelephonyRefSchema } from './shared'

/** The card of an incoming call (design 4.3): the customer behind the number, if the normalized number matched one. */
export const TelephonyLookupPartnerSchema = z.strictObject({
  id: TelephonyIdSchema,
  name: z.string().min(1),
  isCompany: z.boolean(),
  company: TelephonyRefSchema.nullable(),
})

/**
 * `GET /api/v1/telephony/lookup?number=`. `partner` is null for an unknown number, and the screen then offers to save
 * a contact with `number` prefilled. `calls` are the last calls of that customer or number, newest first.
 */
export const TelephonyLookupSchema = z.strictObject({
  number: TelephonyNumberSchema,
  partner: TelephonyLookupPartnerSchema.nullable(),
  calls: z.array(TelephonyCallSchema),
})

export type TelephonyLookupPartner = z.infer<typeof TelephonyLookupPartnerSchema>
export type TelephonyLookup = z.infer<typeof TelephonyLookupSchema>
