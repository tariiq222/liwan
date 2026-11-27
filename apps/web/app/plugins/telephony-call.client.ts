import type { CallChipState } from '@liwan/ui/app/composables/useCallChip'
import { provideCallChip } from '@liwan/ui/app/composables/useCallChip'
import { useSoftphone } from '@/composables/useSoftphone'

/**
 * Wires the telephony softphone into the shell's call chip (design D3).
 *
 * The shell owns the chip and draws it from a seam; this plugin is the application side of that seam. It runs only in
 * the browser, only for a user who may use the phone, and only once the app is interactive: the session password is
 * short-lived, so requesting it earlier would send it to a page nobody is using.
 */
export default defineNuxtPlugin(() => {
  const { can } = useAccess()
  const hydrated = useHydrated()
  const phone = useSoftphone()
  const { t } = useI18n()

  const state: Ref<CallChipState> = computed(() => ({
    phase: phone.state.phase,
    remote: phone.state.remote,
    since: phone.state.since,
    failure: phone.state.failure,
  }))

  provideCallChip({
    state,
    actions: {
      answer: () => phone.answer(),
      hangUp: () => phone.hangUp(),
      reject: () => phone.hangUp(),
    },
    labels: {
      idle: t('telephony.chip.idle'),
      label: t('telephony.chip.label'),
      callerCard: t('telephony.chip.callerCard'),
      answer: t('telephony.chip.answer'),
      reject: t('telephony.chip.reject'),
      hangUp: t('telephony.chip.hangUp'),
      failedHint: t('telephony.chip.failedHint'),
      failed: t('telephony.chip.failed'),
      ringing: number => t('telephony.chip.ringing', { number }),
      calling: number => t('telephony.chip.calling', { number }),
      inCall: duration => t('telephony.chip.inCall', { duration }),
    },
  })

  watch([hydrated, () => can('telephony.use')], ([ready, allowed]) => {
    if (ready && allowed && phone.state.phase === 'idle') phone.register()
  }, { immediate: true })
})
