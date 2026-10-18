import { z } from 'zod'
import { day, id, list, text } from './shared'

export const FinanceCountrySchema = z.object({ id, name: z.string(), code: z.string() }).strict()
export const FinanceCountryStateSchema = z.object({ id, name: z.string(), code: z.string() }).strict()

export const FinanceCountryListSchema = list(FinanceCountrySchema)
export const FinanceCountryStateListSchema = list(FinanceCountryStateSchema)

// Every key is optional: the date defaults to today in Odoo and the lines are not copied.
export const FinanceDebitNoteCreateSchema = z.object({
  reason: text.optional(),
  date: day.optional(),
  copy_lines: z.boolean().optional(),
}).strict()

export type FinanceCountry = z.infer<typeof FinanceCountrySchema>
export type FinanceCountryState = z.infer<typeof FinanceCountryStateSchema>
export type FinanceCountryList = z.infer<typeof FinanceCountryListSchema>
export type FinanceCountryStateList = z.infer<typeof FinanceCountryStateListSchema>
export type FinanceDebitNoteCreate = z.infer<typeof FinanceDebitNoteCreateSchema>
