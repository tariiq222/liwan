import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { transaction } from '../db.js'

export type BillingSettings = {
  refund_window_days: number
  bank_account_name: string
  bank_account_number: string
  bank_iban: string
  bank_instructions_ar: string
  bank_instructions_en: string
}

const text = (max: number) => z.string().trim().max(max)

/** Vendor input for the one settings row. Every field is optional: an omitted one keeps its stored value. */
export const billingSettingsInputSchema = z.strictObject({
  refund_window_days: z.number().int().min(0).max(365).optional(),
  bank_account_name: text(200).optional(),
  bank_account_number: text(64).optional(),
  // An IBAN is the only account form Liwan shows a customer today; empty means bank transfer is not offered yet.
  bank_iban: z.union([z.literal(''), z.string().trim().regex(/^SA[0-9]{22}$/, 'invalid_iban')]).optional(),
  bank_instructions_ar: text(500).optional(),
  bank_instructions_en: text(500).optional(),
  reason: z.string().trim().min(3).max(1000),
})
export type BillingSettingsInput = z.infer<typeof billingSettingsInputSchema>

const COLUMNS = 'refund_window_days,bank_account_name,bank_account_number,bank_iban,bank_instructions_ar,bank_instructions_en' as const
function view(row: Record<string, any>): BillingSettings {
  return {
    refund_window_days: Number(row.refund_window_days),
    bank_account_name: row.bank_account_name as string,
    bank_account_number: row.bank_account_number as string,
    bank_iban: row.bank_iban as string,
    bank_instructions_ar: row.bank_instructions_ar as string,
    bank_instructions_en: row.bank_instructions_en as string,
  }
}

export async function billingSettings(pool: Pick<Pool, 'query'>): Promise<BillingSettings> {
  const row = (await pool.query(`SELECT ${COLUMNS} FROM billing_settings WHERE singleton`)).rows[0]
  if (!row) throw new Error('billing_settings_missing')
  return view(row)
}

/** The bank account a customer transfers to, or null while the vendor has not filled it in. */
export function bankAccountOf(settings: BillingSettings) {
  return settings.bank_iban ? { account_name: settings.bank_account_name, account_number: settings.bank_account_number, iban: settings.bank_iban,
    instructions_ar: settings.bank_instructions_ar, instructions_en: settings.bank_instructions_en } : null
}

/**
 * Records what the vendor changed. The row is a single current setting, not a revision history: every change is
 * audited with its reason, which is where an earlier value is read from.
 */
export async function setBillingSettings(pool: Pool, input: BillingSettingsInput & { operator: string }): Promise<BillingSettings> {
  const { reason, operator, ...fields } = input
  const parsed = billingSettingsInputSchema.parse({ ...fields, reason })
  return transaction(pool, async client => {
    const before = (await client.query(`SELECT ${COLUMNS} FROM billing_settings WHERE singleton FOR UPDATE`)).rows[0]
    if (!before) throw new Error('billing_settings_missing')
    const next = { ...view(before), ...Object.fromEntries(Object.entries(parsed).filter(([key, value]) => key !== 'reason' && value !== undefined)) }
    const updated = (await client.query(`UPDATE billing_settings SET refund_window_days=$1,bank_account_name=$2,bank_account_number=$3,bank_iban=$4,
      bank_instructions_ar=$5,bank_instructions_en=$6,updated_by=$7,updated_at=now() WHERE singleton RETURNING ${COLUMNS}`,
    [next.refund_window_days, next.bank_account_name, next.bank_account_number, next.bank_iban, next.bank_instructions_ar, next.bank_instructions_en, operator])).rows[0]
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), operator, 'billing.settings_updated', 'billing_settings', reason, JSON.stringify({ before: view(before), after: view(updated) })])
    return view(updated)
  })
}
