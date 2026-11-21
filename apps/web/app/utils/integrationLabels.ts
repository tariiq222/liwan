import { saveErrorMessage } from './formFeedback'

type Translate = (key: string, params?: Record<string, unknown>) => string
type Exists = (key: string) => boolean

/** The customer-facing name of a provider; a provider a newer server adds shows its code. */
export function integrationProviderLabel(code: string, t: Translate, te: Exists): string {
  const key = `integrations.provider.${code}`
  return te(key) ? t(key) : code
}

/** The customer-facing name of a use (`inbox.whatsapp`); an unknown use key is shown as it is. */
export function integrationUseLabel(key: string, t: Translate, te: Exists): string {
  const path = `integrations.use.${key}`
  return te(path) ? t(path) : key
}

/** The name of a typed secret (`access_token`); an unknown name is shown as it is. */
export function integrationSecretLabel(name: string, t: Translate, te: Exists): string {
  const key = `integrations.secret.${name}`
  return te(key) ? t(key) : name
}

/** The name of a non-secret field a provider asks for (`app_id`); an unknown name is shown as it is. */
export function integrationAttributeLabel(name: string, t: Translate, te: Exists): string {
  const key = `integrations.attribute.${name}`
  return te(key) ? t(key) : name
}

/** The applications using a connection as one sentence, or the line saying nothing uses it yet. */
export function integrationUsedBy(uses: readonly string[], t: Translate, te: Exists): string {
  if (!uses.length) return t('integrations.connections.unused')
  return t('integrations.connections.usedBy', { uses: uses.map(use => integrationUseLabel(use, t, te)).join(t('integrations.separator')) })
}

const ERROR_KEYS: Readonly<Record<string, string>> = {
  forbidden: 'integrations.errors.forbidden',
  not_found: 'integrations.errors.notFound',
  in_use: 'integrations.errors.inUse',
  invalid: 'integrations.errors.invalid',
  integration_not_configured: 'integrations.errors.notConfigured',
  integration_rejected: 'integrations.errors.rejected',
  provider_error: 'integrations.errors.providerError',
  // The refusals of the messaging service (IntegrationMessagingErrorCodeSchema) and the ones the voice and
  // lookup services share with it (IntegrationVoiceErrorCodeSchema, IntegrationLookupErrorCodeSchema).
  invalid_phone: 'integrations.errors.invalidPhone',
  no_default_sender: 'integrations.errors.noDefaultSender',
  sender_unavailable: 'integrations.errors.senderUnavailable',
  connection_disabled: 'integrations.errors.connectionDisabled',
  daily_limit_reached: 'integrations.errors.dailyLimitReached',
  body_too_long: 'integrations.errors.bodyTooLong',
  tenant_read_only: 'integrations.errors.tenantReadOnly',
  text_too_long: 'integrations.errors.textTooLong',
  no_connection: 'integrations.errors.noConnection',
  lookup_failed: 'integrations.errors.lookupFailed',
}

/** The locale key worded for a refusal code, or null when the code has none (the caller then shows the API's own text). */
export function integrationErrorKey(error: unknown): string | null {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return typeof code === 'string' && Object.hasOwn(ERROR_KEYS, code) ? ERROR_KEYS[code]! : null
}

/** The refusal in the customer's language: the worded text of its code, else the API's own text, else the generic one. */
export function integrationErrorText(error: unknown, t: Translate): string {
  const key = integrationErrorKey(error)
  return key ? t(key) : saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
}

/** The server's own words for a refusal (an `in_use` message names the uses), or an empty string when it has none. */
export function integrationServerMessage(error: unknown): string {
  if (!error || typeof error !== 'object' || !('status' in error) || !('message' in error)) return ''
  return error.status !== 0 && typeof error.message === 'string' ? error.message : ''
}

const OAUTH_REASONS: ReadonlySet<string> = new Set(['denied', 'invalid_state', 'not_configured', 'rejected', 'scopes_missing', 'account_taken'])

/** The locale key of an OAuth return error: a reason the page words, else the generic one. */
export function oauthReasonKey(reason: string): string {
  return OAUTH_REASONS.has(reason) ? `integrations.oauth.errors.${reason}` : 'integrations.oauth.errors.other'
}
