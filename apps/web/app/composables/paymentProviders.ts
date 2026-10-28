import { PaymentProviderStateSchema, type PaymentProvider, type PaymentProviderList, type PaymentProviderState, type PaymentProviderSyncStatus } from '@webvue/contracts'
import { statusBadgeEntry, type StatusBadgeEntry } from '@webvue/ui/app/utils/statusBadge'

/** The modes a gateway can run in, in the order the mode control shows them: off, sandbox, live. */
export const PAYMENT_PROVIDER_STATES: readonly PaymentProviderState[] = PaymentProviderStateSchema.options

const STATE_BADGES: Readonly<Record<PaymentProviderState, StatusBadgeEntry>> = {
  disabled: { tone: 'neutral', labelKey: 'payments.state.disabled' },
  test: { tone: 'info', labelKey: 'payments.state.test' },
  enabled: { tone: 'success', labelKey: 'payments.state.enabled' },
}

/** A gateway's mode as a status badge; a mode a newer server adds reads neutral with its raw value. */
export function paymentStateBadge(state: string): StatusBadgeEntry {
  return statusBadgeEntry(STATE_BADGES, state)
}

/** The mode a control value names, or null for anything else. */
export function paymentProviderState(value: string): PaymentProviderState | null {
  const parsed = PaymentProviderStateSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

const CREDENTIAL_LABEL_KEYS: Readonly<Record<string, string>> = {
  paymob_public_key: 'payments.credentials.paymob_public_key',
  paymob_secret_key: 'payments.credentials.paymob_secret_key',
  paymob_hmac_key: 'payments.credentials.paymob_hmac_key',
  paymob_api_key: 'payments.credentials.paymob_api_key',
}

/** The locale key naming a credential input, or undefined for a field a newer server adds (the page shows the field name). */
export function credentialLabelKey(field: string): string | undefined {
  return Object.hasOwn(CREDENTIAL_LABEL_KEYS, field) ? CREDENTIAL_LABEL_KEYS[field] : undefined
}

/** The body of a credentials save: only the fields the user typed, trimmed. A blank input leaves its saved key as it is. */
export function credentialsPatch(typed: Readonly<Record<string, string>>): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const [field, value] of Object.entries(typed)) {
    const trimmed = value.trim()
    if (trimmed) patch[field] = trimmed
  }
  return patch
}

const CREDENTIAL_FIELD_PREFIX = 'credentials.'

/** The credential input a refusal names (`credentials.<name>`), or null when it names none. */
export function failedCredential(error: unknown): string | null {
  const field = error && typeof error === 'object' && 'field' in error ? error.field : undefined
  return typeof field === 'string' && field.startsWith(CREDENTIAL_FIELD_PREFIX) && field.length > CREDENTIAL_FIELD_PREFIX.length
    ? field.slice(CREDENTIAL_FIELD_PREFIX.length)
    : null
}

const ERROR_KEYS: Readonly<Record<string, string>> = {
  provider_not_configured: 'payments.errors.notConfigured',
  provider_disabled: 'payments.errors.disabled',
  provider_sync_failed: 'payments.errors.syncFailed',
  methods_missing: 'payments.errors.methodsMissing',
  invalid: 'payments.errors.invalid',
  unknown_field: 'payments.errors.invalid',
}

/** The locale key of a refusal this page words itself, or null to show the API's own text. */
export function providerErrorKey(error: unknown): string | null {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return typeof code === 'string' && Object.hasOwn(ERROR_KEYS, code) ? ERROR_KEYS[code]! : null
}

/** How a finished connection test is shown: its alert colour and the locale keys of its title and explanation. */
export const SYNC_OUTCOMES: Readonly<Record<PaymentProviderSyncStatus, { color: 'success' | 'warning'; titleKey: string; descriptionKey: string }>> = {
  synced: { color: 'success', titleKey: 'payments.sync.synced.title', descriptionKey: 'payments.sync.synced.hint' },
  methods_missing: { color: 'warning', titleKey: 'payments.sync.methodsMissing.title', descriptionKey: 'payments.sync.methodsMissing.hint' },
}

/** A country's name in the UI language from its two-letter code (the contract guarantees the shape). */
export function countryName(code: string, locale: string): string {
  return new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }).of(code) ?? code
}

/** The list with one gateway replaced by the server's answer; the total does not change. */
export function replaceProvider(list: PaymentProviderList, provider: PaymentProvider): PaymentProviderList {
  return { ...list, items: list.items.map(item => (item.id === provider.id ? provider : item)) }
}
