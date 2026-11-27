import type { InjectionKey, Ref } from 'vue'
import { inject, provide } from 'vue'

/**
 * The seam between the shell and the application's softphone (design D3).
 *
 * The shell draws the call chip, because the chip lives in the header and the header belongs to the shell. The phone
 * itself belongs to the telephony application, so the application provides this state and the shell reads it: no
 * application component is imported by the shell, and the call chip disappears entirely when nobody provides one.
 */
export type CallChipPhase = 'idle' | 'connecting' | 'registered' | 'ringing' | 'calling' | 'in-call' | 'failed'

export interface CallChipState {
  phase: CallChipPhase
  remote: string | null
  since: number | null
  failure: string | null
}

export interface CallChipActions {
  answer: () => void
  hangUp: () => void
  reject: () => void
}

export interface CallChipLabels {
  idle: string
  label: string
  callerCard: string
  answer: string
  reject: string
  hangUp: string
  failedHint: string
  failed: string
  ringing: (number: string) => string
  calling: (number: string) => string
  inCall: (duration: string) => string
}

export interface CallChipSeam {
  state: Ref<CallChipState>
  actions: CallChipActions
  labels: CallChipLabels
}

export const CALL_CHIP: InjectionKey<CallChipSeam> = Symbol('liwan-call-chip')

export function provideCallChip(seam: CallChipSeam) {
  provide(CALL_CHIP, seam)
}

export function useCallChip(): CallChipSeam | null {
  return inject(CALL_CHIP, null)
}
