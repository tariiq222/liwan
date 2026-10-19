import { z } from 'zod'
import { day, text } from './shared'

// Every key is optional: the date defaults to today in Odoo and the lines are not copied.
export const FinanceDebitNoteCreateSchema = z.object({
  reason: text.optional(),
  date: day.optional(),
  copy_lines: z.boolean().optional(),
}).strict()

export type FinanceDebitNoteCreate = z.infer<typeof FinanceDebitNoteCreateSchema>
