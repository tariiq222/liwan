import type { ComputedRef, InjectionKey, MaybeRef, Ref } from 'vue'
import { computed, inject, provide, unref } from 'vue'

/**
 * The seam between the shell and the application's softphone (design D3).
 *
 * The shell draws the call chip, because the chip lives in the header and the header belongs to the shell. The phone
 * itself belongs to the telephony application, so the application provides this state and the shell reads it: no
 * application component is imported by the shell, and the call chip disappears entirely when nobody provides one.
 */
export type CallChipPhase = 'idle' | 'connecting' | 'registered' | 'ringing' | 'calling' | 'in-call' | 'failed'

export interface CallChipRecentCall {
  id: number
  direction: string
  state: string
  time: string | null
  duration: string | null
}

export interface CallChipCallerCard {
  partnerName: string | null
  companyName: string | null
  number: string | null
  recentCalls: CallChipRecentCall[]
  saveContactTo: string | null
}

export interface CallChipState {
  phase: CallChipPhase
  remote: string | null
  registeredAs: string | null
  since: number | null
  failure: string | null
  hasExtension: boolean
  isLeader: boolean
  muted: boolean
  held: boolean
  transferring: boolean
  transferError: string | null
  callerCard: CallChipCallerCard | null
  callerCardLoading: boolean
}

export interface CallChipActions {
  answer: () => void
  reject: () => void
  hangUp: () => void
  call: (number: string) => string | null | void
  toggleMute: () => void
  toggleHold: () => void
  transfer: (target: string) => string | null | void
  sendDtmf: (digit: string) => void
  retry: () => void
}

export interface CallChipLabels {
  label: string
  idle: string
  ringing: (number: string) => string
  calling: (number: string) => string
  inCall: (duration: string) => string
  failed: string
  failedHint: string
  retry: string
  noExtension: string
  callerCard: string
  unknownCaller: string
  loadingCaller: string
  recentCalls: string
  saveContact: string
  answer: string
  reject: string
  hangUp: string
  mute: string
  unmute: string
  hold: string
  resume: string
  transfer: string
  transferPlaceholder: string
  transferSend: string
  transferring: string
  keypad: string
  dialpadTitle: string
  dialPlaceholder: string
  dialCall: string
  backspace: string
}

export interface CallChipSeam {
  state: Ref<CallChipState>
  actions: CallChipActions
  labels: MaybeRef<CallChipLabels>
}

export const CALL_CHIP: InjectionKey<MaybeRef<CallChipSeam | null>> = Symbol('liwan-call-chip')

export function provideCallChip(seam: MaybeRef<CallChipSeam | null>) {
  provide(CALL_CHIP, seam)
}

export function useCallChip(): ComputedRef<CallChipSeam | null> {
  const provided = inject(CALL_CHIP, null)
  return computed(() => unref(provided))
}
