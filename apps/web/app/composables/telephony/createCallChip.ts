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
import { useSoftphone, type SoftphoneOptions } from '../useSoftphone'

const ACTIVE_PHASES = new Set(['ringing', 'calling', 'in-call'])

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
): AppCallChipHandle {
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

    function saveContactLinkFor(phoneNumber: string): string | null {
      if (!context.can('customers.manage')) return null
      return `/customers/new?phone=${encodeURIComponent(phoneNumber)}&returnTo=${encodeURIComponent(context.currentPath())}`
    }

    async function lookupCaller(number: string) {
      lookupController?.abort()
      const controller = new AbortController()
      lookupController = controller
      callerCardLoading.value = true
      try {
        const result = await context.$api('/api/v1/telephony/lookup', {
          query: { number },
          schema: TelephonyLookupSchema,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
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
        if ((error as { name?: string } | null)?.name === 'AbortError' || controller.signal.aborted) return
        callerCard.value = {
          partnerName: null,
          companyName: null,
          number,
          recentCalls: [],
          saveContactTo: saveContactLinkFor(number),
        }
      } finally {
        if (lookupController === controller) {
          callerCardLoading.value = false
        }
      }
    }

    watch(
      () => [phone.state.phase, phone.state.remote] as const,
      ([phase, remote]) => {
        if (!ACTIVE_PHASES.has(phase) || !remote) {
          lookupController?.abort()
          lookupController = null
          callerCard.value = null
          callerCardLoading.value = false
          lastLookedUpNumber = null
          return
        }
        if (remote !== lastLookedUpNumber) {
          lastLookedUpNumber = remote
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
      failure: phone.state.failure,
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
      call: (raw) => {
        const error = phone.call(raw)
        return error ? context.t('telephony.chip.invalidNumber') : null
      },
      toggleMute: () => phone.toggleMute(),
      toggleHold: () => phone.toggleHold(),
      transfer: (raw) => {
        const error = phone.transfer(raw)
        return error ? context.t('telephony.chip.invalidNumber') : null
      },
      sendDtmf: digit => phone.sendDtmf(digit),
      retry: () => { void phone.retry() },
    }

    void phone.register()

    return { phone, seam: { state, actions, labels } }
  })!

  return {
    seam: built.seam,
    stop: async () => {
      lookupController?.abort()
      lookupController = null
      await built.phone.stop()
      scope.stop()
    },
  }
}
