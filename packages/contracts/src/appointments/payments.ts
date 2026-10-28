import { z } from 'zod'

/**
 * How a booking type is paid online (the `webvue_appointments_payments` bridge, behind
 * `payments.enabled`): not at all, in full, or a deposit of `deposit_percent` of the price. `price` is
 * the list price of the type's own product, before taxes, in `currency`; null until it is first set.
 */
export const AppointmentOnlinePaymentSchema = z.enum(['none', 'full', 'deposit'])

export const APPOINTMENT_DEPOSIT_PERCENT = { min: 1, max: 99 } as const

const DepositPercentSchema = z.number().int().min(APPOINTMENT_DEPOSIT_PERCENT.min).max(APPOINTMENT_DEPOSIT_PERCENT.max)

export const AppointmentTypePaymentSchema = z.object({
  online_payment: AppointmentOnlinePaymentSchema,
  deposit_percent: DepositPercentSchema,
  price: z.number().positive().nullable(),
  currency: z.string().length(3),
}).strict()

/** PATCH body: a type takes online payment only once it has a price (422 on `price` otherwise). */
export const AppointmentTypePaymentUpdateSchema = z.object({
  online_payment: AppointmentOnlinePaymentSchema.optional(),
  deposit_percent: DepositPercentSchema.optional(),
  price: z.number().positive().optional(),
}).strict().refine(body => Object.keys(body).length > 0, { message: 'send at least one field' })

/**
 * The payment of one booking's online order: the pay-page statuses (`payable`, `processing`, `paid`,
 * `not_payable`) plus `none` (no order: a free type, or a tenant without online payments) and
 * `cancelled` (the order expired or the booking was cancelled). `refund_due`: money was received that
 * must be given back (staff refund it).
 */
export const AppointmentBookingPaymentStatusSchema = z.enum(['none', 'payable', 'processing', 'paid', 'not_payable', 'cancelled'])

export const AppointmentBookingPaymentSchema = z.object({
  status: AppointmentBookingPaymentStatusSchema,
  refund_due: z.boolean(),
  currency: z.string().length(3).nullable(),
  amount_total: z.number().nullable(),
  amount_due: z.number().nullable(),
  expires_at: z.string().datetime().nullable(),
}).strict()

export type AppointmentOnlinePayment = z.infer<typeof AppointmentOnlinePaymentSchema>
export type AppointmentTypePayment = z.infer<typeof AppointmentTypePaymentSchema>
export type AppointmentTypePaymentUpdate = z.infer<typeof AppointmentTypePaymentUpdateSchema>
export type AppointmentBookingPaymentStatus = z.infer<typeof AppointmentBookingPaymentStatusSchema>
export type AppointmentBookingPayment = z.infer<typeof AppointmentBookingPaymentSchema>
