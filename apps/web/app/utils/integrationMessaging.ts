import {
  IntegrationMessageStateSchema,
  type IntegrationMessageState,
  type IntegrationMessageStateView,
  type IntegrationProvider,
} from '@liwan/contracts'

/** What the reader sees: the stored state, with `sent` split by whether a delivery receipt can still arrive. */
export type IntegrationMessageStage = 'queued' | 'sent' | 'sentNoReceipt' | 'delivered' | 'undelivered' | 'failed' | 'unconfirmed'

export const MESSAGE_STATES: readonly IntegrationMessageState[] = IntegrationMessageStateSchema.options

export function messageStage(message: Pick<IntegrationMessageStateView, 'state' | 'has_receipt'>): IntegrationMessageStage {
  if (message.state === 'sent' && !message.has_receipt) return 'sentNoReceipt'
  return message.state
}

const STAGE_TONES: Record<IntegrationMessageStage, 'success' | 'destructive' | 'warning' | 'neutral'> = {
  queued: 'warning', sent: 'neutral', sentNoReceipt: 'neutral', delivered: 'success', undelivered: 'destructive', failed: 'destructive', unconfirmed: 'warning',
}
export const messageStageTone = (stage: IntegrationMessageStage) => STAGE_TONES[stage]

/** A message the provider can no longer change: nothing more arrives, so a poll can stop. */
export function messageIsFinal(message: Pick<IntegrationMessageStateView, 'state' | 'has_receipt'>): boolean {
  return message.state !== 'queued' && !(message.state === 'sent' && message.has_receipt)
}

/** Only these can be sent again, and `unconfirmed` may already have reached the provider: the retry warns first. */
export const messageCanRetry = (message: Pick<IntegrationMessageStateView, 'state'>) => message.state === 'failed' || message.state === 'unconfirmed'

/** A provider whose uses include messaging or voice can hold senders (`twilio.messaging`); a use of an application (`inbox.whatsapp`) cannot. */
export const providerHasSenders = (provider: IntegrationProvider) => provider.uses.some(use => /\.(messaging|voice)$/.test(use.key))

/** "1=value" lines of the template variables field, as the object the provider takes. A line without `=` is invalid. */
export function parseTemplateVariables(text: string): Record<string, string> | null {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const entries = lines.map(line => {
    const at = line.indexOf('=')
    return at > 0 ? [line.slice(0, at).trim(), line.slice(at + 1).trim()] as const : null
  })
  if (entries.some(entry => entry === null || !entry[0])) return null
  return Object.fromEntries(entries as Array<readonly [string, string]>)
}
