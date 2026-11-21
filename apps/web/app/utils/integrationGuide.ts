import type { IntegrationConnection } from '@liwan/contracts'

export type GuideState = 'todo' | 'done' | 'problem' | 'pending' | 'unchecked'

/** One step of a provider guide. Its texts are the locale keys under `integrations.guide.<code>.steps.<key>`. */
export interface GuideStep {
  key: string
  state: GuideState | null
  /** Key under `integrations.guide.<code>.result` of what the stored connection reports, or ''. */
  result: string
  /** Keys under the step's own namespace, each one a sub-line. */
  lines: string[]
  /** Provider identifiers shown as code chips, with the locale key (under the provider's guide) of their label. */
  codes: { label: string, items: string[] } | null
  /** Key under the step's own namespace of one extra paragraph, or ''. */
  note: string
}

type Outcome = Pick<GuideStep, 'state' | 'result'>
type Secrets = IntegrationConnection['secrets']

// The permissions and the webhook fields are Meta's own identifiers, so they are not translated. Every field after
// `messages` is one the inbox webhook processes (odoo-addons/liwan_inbox/adapters/whatsapp.py).
const META_PERMISSIONS = ['whatsapp_business_messaging', 'whatsapp_business_management']
const META_WEBHOOK_FIELDS = [
  'messages', 'message_template_status_update', 'message_template_quality_update', 'template_category_update', 'flows',
  'phone_number_quality_update', 'phone_number_name_update', 'account_update', 'business_capability_update', 'account_alerts',
]

const GUIDE_PROVIDERS: ReadonlySet<string> = new Set(['meta', 'twilio'])
const NONE: Outcome = { state: null, result: '' }
const UNCHECKED: Outcome = { state: 'unchecked', result: '' }

/** Whether the provider has a step guide on its connect form and its connection page. */
export const hasIntegrationGuide = (code: string): boolean => GUIDE_PROVIDERS.has(code)

const present = (secrets: Secrets | undefined, name: string) => secrets?.some(secret => secret.name === name && secret.present) ?? false

const step = (key: string, outcome: Outcome, extra: Partial<Pick<GuideStep, 'lines' | 'codes' | 'note'>> = {}): GuideStep =>
  ({ key, ...outcome, lines: [], codes: null, note: '', ...extra })

// The probe reads the business account with the token, so only a connected state proves the token and the account ID.
function metaToken(connection: IntegrationConnection): Outcome {
  if (!present(connection.secrets, 'access_token')) return { state: 'todo', result: 'tokenTodo' }
  if (connection.state === 'connected') return { state: 'done', result: 'tokenDone' }
  if (connection.state === 'error') return { state: 'problem', result: 'tokenProblem' }
  return { state: 'pending', result: 'tokenPending' }
}
function metaValues(connection: IntegrationConnection): Outcome {
  if (connection.state === 'error') return { state: 'problem', result: 'valuesProblem' }
  if (!present(connection.secrets, 'app_secret')) return { state: 'todo', result: 'valuesTodo' }
  return connection.state === 'connected' ? { state: 'done', result: 'valuesDone' } : { state: 'pending', result: 'tokenPending' }
}
const metaWebhook = (connection: IntegrationConnection): Outcome =>
  present(connection.secrets, 'verify_token') ? { state: 'done', result: 'webhookDone' } : { state: 'todo', result: 'webhookTodo' }

function metaSteps(connection?: IntegrationConnection): GuideStep[] {
  return [
    step('app', connection ? UNCHECKED : NONE),
    step('token', connection ? metaToken(connection) : NONE, { codes: { label: 'permissions', items: META_PERMISSIONS } }),
    step('values', connection ? metaValues(connection) : NONE, { lines: ['accountId', 'appId', 'phoneId'] }),
    step('webhook', connection ? metaWebhook(connection) : NONE, { note: connection ? 'after' : 'before' }),
    step('fields', connection ? UNCHECKED : NONE, { codes: { label: '', items: META_WEBHOOK_FIELDS } }),
  ]
}

// The probe reads the account with the SID and the auth token, so a connected state proves both.
function twilioCredentials(connection: IntegrationConnection): Outcome {
  if (!present(connection.secrets, 'auth_token')) return { state: 'todo', result: 'credentialsTodo' }
  if (connection.state === 'connected') return { state: 'done', result: 'credentialsDone' }
  if (connection.state === 'error') return { state: 'problem', result: 'credentialsProblem' }
  return { state: 'pending', result: 'credentialsPending' }
}

// Only the first step reads the stored connection; the rest teach what no probe can check.
function twilioSteps(connection?: IntegrationConnection): GuideStep[] {
  return [
    step('credentials', connection ? twilioCredentials(connection) : NONE),
    ...['apiKeys', 'trial', 'region', 'saudiSender', 'charges'].map(key => step(key, NONE)),
  ]
}

/** The steps of a provider's guide, with what the stored connection reports once there is one. */
export function guideSteps(code: string, connection?: IntegrationConnection): GuideStep[] {
  if (code === 'meta') return metaSteps(connection)
  if (code === 'twilio') return twilioSteps(connection)
  return []
}
