import { computed, effectScope, ref, watch } from 'vue'
import { TelephonyLookupSchema } from '@liwan/contracts'
import type {
  CallChipActions,
  CallChipCallerCard,
  CallChipLabels,
  CallChipState,
} from '@liwan/ui/app/composables/useCallChip'
import { callDuration, callTime } from '../../components/telephony/callPresentation'
import type { AppCallChipHandle, AppCallChipHostContext } from '../../modules/types'
import {
  useSoftphone,
  type DialActionError,
  type PhoneFailureCode,
  type SoftphoneOptions,
  type SoftphoneStopOptions,
} from '../useSoftphone'

const ACTIVE_PHASES = new Set(['ringing', 'calling', 'in-call'])

export interface TelephonyCallChipHandle extends AppCallChipHandle {
  stop: (options?: SoftphoneStopOptions) => Promise<void>
}

/**
 * Application-owned factory for the header call chip (design D3).
 *
 * Loaded lazily by `useCallChipHost` through `manifest.callChip`, so the shell never imports telephony code (R3).
 * Runs inside a detached `effectScope` whose lifecycle ends cleanly when `stop()` is called on capability loss,
 * company switch, sign-out, or layout unmount.
 */
export function createCallChip(
  context: AppCallChipHostContext,
  softphoneOptions: Partial<SoftphoneOptions> = {},
): TelephonyCallChipHandle {
  const scope = effectScope(true)
  let lookupController: AbortController | null = null

  const built = scope.run(() => {
    const phone = useSoftphone({
      ...softphoneOptions,
      $api: softphoneOptions.$api ?? context.$api,
      identity: softphoneOptions.identity ?? (() => (
        context.me.value
          ? { userId: context.me.value.id, companyId: context.me.value.company.id }
          : null
      )),
    })

    const callerCard = ref<CallChipCallerCard | null>(null)
    const callerCardLoading = ref(false)
    let lastLookedUpNumber: string | null = null
    let lookupSeq = 0

    function isExternalNumber(number: string): boolean {
      return number.startsWith('+')
    }

    function saveContactLinkFor(phoneNumber: string): string | null {
      if (!isExternalNumber(phoneNumber) || !context.can('customers.manage')) return null
      const currentPath = context.currentPath()
      const base = `/customers/new?phone=${encodeURIComponent(phoneNumber)}`
      return currentPath === '/customers' || currentPath.startsWith('/customers?') || currentPath.startsWith('/customers#')
        ? `${base}&returnTo=${encodeURIComponent(currentPath)}`
        : base
    }

    function translateFailure(code: PhoneFailureCode | null): string | null {
      if (!code) return null
      switch (code) {
        case 'connection_closed': return context.t('telephony.chip.failure.connectionClosed')
        case 'registration_failed': return context.t('telephony.chip.failure.registrationFailed')
        case 'renewal_failed': return context.t('telephony.chip.failure.renewalFailed')
        case 'start_failed': return context.t('telephony.chip.failure.startFailed')
        case 'call_failed': return context.t('telephony.chip.failure.callFailed')
      }
    }

    function translateDialError(error: DialActionError): string | null {
      if (!error) return null
      return error === 'unavailable'
        ? context.t('telephony.chip.phoneNotReady')
        : context.t('telephony.chip.invalidNumber')
    }

    async function lookupCaller(number: string) {
      lookupController?.abort()
      const controller = new AbortController()
      lookupController = controller
      const seq = ++lookupSeq
      callerCard.value = null
      callerCardLoading.value = true
      try {
        const result = await context.$api('/api/v1/telephony/lookup', {
          query: { number },
          schema: TelephonyLookupSchema,
          signal: controller.signal,
        })
        if (controller.signal.aborted || seq !== lookupSeq) return
        const tz = context.me.value?.tz
        callerCard.value = {
          partnerName: result.partner?.name ?? null,
          companyName: result.partner?.company?.name ?? null,
          number: result.number,
          recentCalls: result.calls.map(entry => ({
            id: entry.id,
            direction: context.t(`telephony.direction.${entry.direction}`),
            state: context.t(`telephony.state.${entry.state}`),
            time: callTime(entry.startedAt, tz),
            duration: callDuration(entry.durationSeconds),
          })),
          saveContactTo: result.partner === null ? saveContactLinkFor(result.number) : null,
        }
      } catch (error) {
        if ((error as { name?: string } | null)?.name === 'AbortError' || controller.signal.aborted || seq !== lookupSeq) return
        callerCard.value = {
          partnerName: null,
          companyName: null,
          number,
          recentCalls: [],
          saveContactTo: saveContactLinkFor(number),
        }
      } finally {
        if (seq === lookupSeq) {
          callerCardLoading.value = false
        }
      }
    }

    watch(
      () => [phone.state.phase, phone.state.remote] as const,
      ([phase, remote]) => {
        if (!ACTIVE_PHASES.has(phase) || !remote) {
          lookupSeq += 1
          lookupController?.abort()
          lookupController = null
          callerCard.value = null
          callerCardLoading.value = false
          lastLookedUpNumber = null
          return
        }
        if (remote !== lastLookedUpNumber) {
          lastLookedUpNumber = remote
          if (!isExternalNumber(remote)) {
            lookupSeq += 1
            lookupController?.abort()
            lookupController = null
            callerCard.value = null
            callerCardLoading.value = false
            return
          }
          void lookupCaller(remote)
        }
      },
      { immediate: true },
    )

    const state = computed<CallChipState>(() => ({
      phase: phone.state.phase,
      remote: phone.state.remote,
      registeredAs: phone.state.registeredAs,
      since: phone.state.since,
      failure: translateFailure(phone.state.failure),
      hasExtension: phone.state.hasExtension,
      isLeader: phone.state.isLeader,
      muted: phone.state.muted,
      held: phone.state.held,
      transferring: phone.state.transferring,
      transferError: phone.state.transferError ? context.t('telephony.chip.transferFailed') : null,
      callerCard: callerCard.value,
      callerCardLoading: callerCardLoading.value,
    }))

    const labels = computed<CallChipLabels>(() => ({
      label: context.t('telephony.chip.label'),
      idle: context.t('telephony.chip.idle'),
      ringing: number => context.t('telephony.chip.ringing', { number }),
      calling: number => context.t('telephony.chip.calling', { number }),
      inCall: duration => context.t('telephony.chip.inCall', { duration }),
      failed: context.t('telephony.chip.failed'),
      failedHint: context.t('telephony.chip.failedHint'),
      retry: context.t('telephony.chip.retry'),
      noExtension: context.t('telephony.chip.noExtension'),
      callerCard: context.t('telephony.chip.callerCard'),
      unknownCaller: context.t('telephony.chip.unknownCaller'),
      loadingCaller: context.t('telephony.chip.loadingCaller'),
      recentCalls: context.t('telephony.chip.recentCalls'),
      saveContact: context.t('telephony.chip.saveContact'),
      answer: context.t('telephony.chip.answer'),
      reject: context.t('telephony.chip.reject'),
      hangUp: context.t('telephony.chip.hangUp'),
      mute: context.t('telephony.chip.mute'),
      unmute: context.t('telephony.chip.unmute'),
      hold: context.t('telephony.chip.hold'),
      resume: context.t('telephony.chip.resume'),
      transfer: context.t('telephony.chip.transfer'),
      transferPlaceholder: context.t('telephony.chip.transferPlaceholder'),
      transferSend: context.t('telephony.chip.transferSend'),
      transferring: context.t('telephony.chip.transferring'),
      keypad: context.t('telephony.chip.keypad'),
      dialpadTitle: context.t('telephony.chip.dialpadTitle'),
      dialPlaceholder: context.t('telephony.chip.dialPlaceholder'),
      dialCall: context.t('telephony.chip.dialCall'),
      backspace: context.t('telephony.chip.backspace'),
    }))

    const actions: CallChipActions = {
      answer: () => phone.answer(),
      reject: () => phone.reject(),
      hangUp: () => phone.hangUp(),
      call: raw => translateDialError(phone.call(raw)),
      toggleMute: () => phone.toggleMute(),
      toggleHold: () => phone.toggleHold(),
      transfer: raw => translateDialError(phone.transfer(raw)),
      sendDtmf: digit => phone.sendDtmf(digit),
      retry: () => { void phone.retry() },
    }

    void phone.register()

    return { phone, seam: { state, actions, labels } }
  })!

  return {
    seam: built.seam,
    stop: async (stopOptions?: SoftphoneStopOptions) => {
      lookupController?.abort()
      lookupController = null
      await built.phone.stop(stopOptions)
      scope.stop()
    },
  }
}
