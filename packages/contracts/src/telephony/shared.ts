import { z } from 'zod'

// The wire primitives of the telephony contracts, shared by every shape in this namespace.

export const TelephonyIdSchema = z.number().int().positive()

// Odoo's iso() writes UTC with a trailing Z; pbx-agent stamps microseconds, so the fraction is optional.
const DateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/
export const TelephonyDateTimeSchema = z.string().regex(DateTimePattern)

// E.164 with the leading plus: the same pattern a customer's phone is stored and matched with.
export const TelephonyNumberSchema = z.string().regex(/^\+[1-9]\d{6,14}$/)

export const TelephonyRefSchema = z.strictObject({ id: TelephonyIdSchema, name: z.string() })

// The standard collection envelope of every telephony list endpoint.
export const TelephonyCollectionSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), total: z.number().int().nonnegative() })
