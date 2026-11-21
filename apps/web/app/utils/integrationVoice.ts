import {
  IntegrationCallStateSchema,
  type IntegrationCallState,
  type IntegrationCallStateView,
  type IntegrationProvider,
} from '@liwan/contracts'

export const CALL_STATES: readonly IntegrationCallState[] = IntegrationCallStateSchema.options

/** A provider whose uses include the voice use can place calls and hold voice senders (`twilio.voice`); the capabilities themselves do not travel, so the use names the capability. */
export const providerHasVoice = (provider: IntegrationProvider) => provider.uses.some(use => /\.voice$/.test(use.key))

const CALL_TONES: Record<IntegrationCallState, 'success' | 'destructive' | 'warning' | 'neutral'> = {
  initiated: 'neutral', ringing: 'neutral', in_progress: 'neutral', completed: 'success', busy: 'warning', no_answer: 'warning', failed: 'destructive', canceled: 'neutral', unconfirmed: 'warning',
}
export const callStageTone = (state: IntegrationCallState) => CALL_TONES[state]

/** A call the provider can no longer change: nothing more arrives, so a poll can stop. A call is never placed again automatically. */
const ACTIVE_STATES: ReadonlySet<string> = new Set(['initiated', 'ringing', 'in_progress'])
export function callIsFinal(call: Pick<IntegrationCallStateView, 'state'>): boolean {
  return !ACTIVE_STATES.has(call.state)
}

/** A call length as m:ss, or null while the call has not ended. */
export function callDuration(seconds: number | null): string | null {
  if (seconds === null) return null
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
