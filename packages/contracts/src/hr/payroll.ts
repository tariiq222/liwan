import { z } from 'zod'
import { HrRefSchema } from './ref'

// The payroll-only compensation of one employee (/api/v1/hr/payroll/compensation/<employee_id>).
// It is served only to `hr.payroll.*` callers and never appears on the general employee shapes.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const amount = z.number().min(0)

export const HrCompensationNationalitySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  code: z.string(),
}).strict()

export const HrCompensationSchema = z.object({
  employee: HrRefSchema,
  basic_wage: amount,
  housing_allowance: amount,
  transport_allowance: amount,
  other_allowance: amount,
  fixed_wage: amount,
  iban: z.string().nullable(),
  bank: HrRefSchema.nullable(),
  gosi_number: z.string().nullable(),
  gosi_registration_date: isoDate.nullable(),
  nationality: HrCompensationNationalitySchema.nullable(),
}).strict()

// A write sends every field; the fixed wage and the nationality are derived by the server.
export const HrCompensationWriteSchema = z.object({
  basic_wage: amount.positive(),
  housing_allowance: amount,
  transport_allowance: amount,
  other_allowance: amount,
  iban: z.string().regex(/^SA\d{22}$/).nullable(),
  bank_id: z.number().int().positive().nullable(),
  gosi_number: z.string().nullable(),
  gosi_registration_date: isoDate.nullable(),
}).strict()

export type HrCompensation = z.infer<typeof HrCompensationSchema>
export type HrCompensationWrite = z.infer<typeof HrCompensationWriteSchema>
