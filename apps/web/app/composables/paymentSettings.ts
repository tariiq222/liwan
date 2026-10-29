import { PAYMENT_ORDER_EXPIRY_MINUTES, type PaymentSettings, type PaymentSettingsUpdate } from '@webvue/contracts'

/** What the orders card edits. The expiry is null while its input is empty. */
export interface OrderSettingsDraft {
  unpaid_order_expiry_minutes: number | null
  invoice_when_paid: boolean
}

export function draftOfSettings(settings: PaymentSettings): OrderSettingsDraft {
  return { unpaid_order_expiry_minutes: settings.unpaid_order_expiry_minutes, invoice_when_paid: settings.invoice_when_paid }
}

/** Whether an expiry is a whole number of minutes the server accepts. */
export function isValidExpiry(minutes: number | null | undefined): minutes is number {
  return typeof minutes === 'number' && Number.isInteger(minutes)
    && minutes >= PAYMENT_ORDER_EXPIRY_MINUTES.min && minutes <= PAYMENT_ORDER_EXPIRY_MINUTES.max
}

/** Whether the draft differs from the saved settings. */
export function isDraftChanged(saved: PaymentSettings, draft: OrderSettingsDraft): boolean {
  return draft.unpaid_order_expiry_minutes !== saved.unpaid_order_expiry_minutes || draft.invoice_when_paid !== saved.invoice_when_paid
}

/**
 * The PATCH body of a save: the revision the draft was made from and only the settings that changed, so a save never
 * touches the tenant-wide switch unless it was flipped. Call it for a changed draft with a valid expiry.
 */
export function settingsUpdate(saved: PaymentSettings, draft: OrderSettingsDraft): PaymentSettingsUpdate {
  const update: PaymentSettingsUpdate = { revision: saved.revision }
  if (draft.unpaid_order_expiry_minutes !== null && draft.unpaid_order_expiry_minutes !== saved.unpaid_order_expiry_minutes) {
    update.unpaid_order_expiry_minutes = draft.unpaid_order_expiry_minutes
  }
  if (draft.invoice_when_paid !== saved.invoice_when_paid) update.invoice_when_paid = draft.invoice_when_paid
  return update
}

/** Whether a refusal names the expiry as the value it refused (`field`), so the card can put it under that input. */
export function refusesExpiry(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'field' in error && error.field === 'unpaid_order_expiry_minutes'
}
