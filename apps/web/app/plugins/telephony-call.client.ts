import type { CallChipState } from '@liwan/ui/app/composables/useCallChip'
import { CALL_CHIP } from '@liwan/ui/app/composables/useCallChip'
import { useSoftphone } from '@/composables/useSoftphone'

/**
 * Wires the telephony softphone into the shell's call chip (design D3).
 *
 * The shell owns the chip and draws it from a seam; this plugin is the application side of that seam. It provides onto
 * the Vue application (a plugin runs before any component, so `provide()` of a component instance is not available
 * here) and registers the phone only for a user who may use it and has an extension: a session password is short-lived
 * and one live registration per extension, so no tab registers before it can actually place a call.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const { can } = useAccess()
  const hydrated = useHydrated()
  const phone = useSoftphone()
  const { t } = useI18n()

  const state = computed<CallChipState>(() => ({
    phase: phone.state.phase,
    remote: phone.state.remote,
    since: phone.state.since,
    failure: phone.state.failure,
  }))

  nuxtApp.vueApp.provide(CALL_CHIP, {
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
