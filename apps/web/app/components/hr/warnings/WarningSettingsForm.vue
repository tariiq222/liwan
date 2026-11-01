<script setup lang="ts">
import type { HrWarningSettings } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'

// The three warning policies of the company, saved together with the revision the manager read.
// A 409 locks the form until the latest values are reloaded, so a stale draft is never saved by accident.
const props = defineProps<{ settings: HrWarningSettings; canEdit: boolean; reloadSettings: () => Promise<HrWarningSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: save, isPending } = usePatchHrWarningSettings()
const baseline = ref(props.settings)
const issuedBy = ref(props.settings.warnings_issued_by)
const acknowledgement = ref(props.settings.warnings_employee_acknowledgement)
const windowMonths = ref<number | undefined>(props.settings.warnings_escalation_window_months)
const failure = ref<unknown>(null)
const reloadFailure = ref<unknown>(null)
const reloading = ref(false)

const validWindow = computed(() => Number.isInteger(windowMonths.value) && windowMonths.value! >= 1 && windowMonths.value! <= 60)
const dirty = computed(() => issuedBy.value !== baseline.value.warnings_issued_by
  || acknowledgement.value !== baseline.value.warnings_employee_acknowledgement
  || windowMonths.value !== baseline.value.warnings_escalation_window_months)
const conflict = computed(() => failure.value instanceof ApiError && failure.value.status === 409)
const locked = computed(() => !props.canEdit || isPending.value || reloading.value || conflict.value)
const message = computed(() => reloadFailure.value
  ? saveErrorMessage(reloadFailure.value, t('errors.generic'), t('errors.saveUncertain'))
  : failure.value ? (conflict.value ? t('hrWarnings.settings.conflict') : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))) : '')

const issuedByItems = computed(() => (['hr_only', 'manager_and_hr'] as const).map(value => ({ value, label: t(`hrWarnings.settings.issuedByOption.${value}`) })))
const acknowledgementItems = computed(() => (['required', 'optional', 'off'] as const).map(value => ({ value, label: t(`hrWarnings.settings.acknowledgementOption.${value}`) })))

function fill(settings: HrWarningSettings) {
  baseline.value = settings
  issuedBy.value = settings.warnings_issued_by
  acknowledgement.value = settings.warnings_employee_acknowledgement
  windowMonths.value = settings.warnings_escalation_window_months
}
// Keep the original revision with the draft: a background refresh cannot silently make a stale draft current.
watch(() => props.settings, (settings) => { if (!dirty.value) fill(settings) })

async function reload() {
  if (reloading.value) return
  reloading.value = true
  reloadFailure.value = null
  try {
    fill(await props.reloadSettings())
    failure.value = null
  } catch (error) { reloadFailure.value = error } finally { reloading.value = false }
}
async function submit() {
  if (!hydrated.value || locked.value || !dirty.value || !validWindow.value) return
  failure.value = null
  try {
    fill(await save({
      warnings_issued_by: issuedBy.value,
      warnings_employee_acknowledgement: acknowledgement.value,
      warnings_escalation_window_months: windowMonths.value!,
      revision: baseline.value.revision,
    }))
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm novalidate :state="{ issuedBy, acknowledgement, windowMonths }" class="liwan-form" method="post" data-testid="hr-warning-settings" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('hrWarnings.settings.title')" :description="t('hrWarnings.settings.hint')">
      <UAlert v-if="message" role="alert" color="error" variant="subtle" :title="t('hrWarnings.settings.saveError')" :description="message" />
      <UButton v-if="conflict" color="neutral" variant="outline" :label="t('hrWarnings.settings.reload')" :loading="reloading" :disabled="reloading" @click="reload" />
      <UFormField :label="t('hrWarnings.settings.issuedBy')" name="warning-issued-by">
        <USelect id="warning-issued-by" v-model="issuedBy" class="w-full" :items="issuedByItems" :disabled="!hydrated || locked" data-testid="hr-warning-issued-by" />
      </UFormField>
      <UFormField :label="t('hrWarnings.settings.acknowledgement')" name="warning-acknowledgement">
        <USelect id="warning-acknowledgement" v-model="acknowledgement" class="w-full" :items="acknowledgementItems" :disabled="!hydrated || locked" data-testid="hr-warning-acknowledgement" />
      </UFormField>
      <UFormField :label="t('hrWarnings.settings.window')" name="warning-window" :help="t('hrWarnings.settings.windowHint')">
        <UInputNumber id="warning-window" v-model="windowMonths" class="w-full" :min="1" :max="60" :step="1" :disabled="!hydrated || locked" data-testid="hr-warning-window" />
      </UFormField>
    </SharedFormSection>
    <SharedFormActions v-if="props.canEdit">
      <UButton type="submit" class="ms-auto" :loading="isPending" :disabled="!hydrated || locked || !dirty || !validWindow" :label="t('app.saveChanges')" data-testid="hr-warning-settings-save" />
    </SharedFormActions>
  </UForm>
</template>
