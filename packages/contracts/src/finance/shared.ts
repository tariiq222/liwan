import { z } from 'zod'

export const id = z.number().int().positive()
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const currency = z.string().min(1)

export const FinanceRefSchema = z.object({ id, name: z.string() }).strict()

export const list = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int().nonnegative() }).strict()

// Request bodies: money is a plain JSON number, never a string.
const MAX_TEXT = 255
// Odoo money columns overflow beyond this; the server answers 422 for a larger number.
export const MAX_NUMBER = 1e12
export const money = z.number().gt(-MAX_NUMBER).lt(MAX_NUMBER)
export const text = z.string().max(MAX_TEXT)
export const requirePatchField = (value: object) => Object.keys(value).length > 0
export const PATCH_MESSAGE = { message: 'At least one field is required' }
