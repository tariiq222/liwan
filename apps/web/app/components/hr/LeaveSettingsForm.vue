<script setup lang="ts">
import type { HrLeaveSettings } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'

const props = defineProps<{ settings: HrLeaveSettings; canEdit: boolean; reloadSettings: () => Promise<HrLeaveSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: save, isPending } = useSaveHrLeaveSettings()
// Keep the original revision with the draft: background refreshes cannot silently make a stale draft current.
const baseline = ref(props.settings)
const policy = ref(props.settings.cancellation_policy)
const failure = ref<unknown>(null)
const reloading = ref(false)
const reloadFailure = ref(false)
const dirty = computed(() => policy.value !== baseline.value.cancellation_policy)
watch(() => props.settings, (settings) => {
  if (!dirty.value && !reloading.value && !conflict.value) {
    baseline.value = settings
    policy.value = settings.cancellation_policy
  }
})
const items = computed(() => [
  { value: 'manager_approval', label: t('hr.leaveSettings.managerApproval') },
  { value: 'direct_employee', label: t('hr.leaveSettings.directEmployee') },
  { value: 'manager_only', label: t('hr.leaveSettings.managerOnly') },
])
const conflict = computed(() => failure.value instanceof ApiError && failure.value.status === 409)
const message = computed(() => failure.value ? (conflict.value ? t('hr.leaveSettings.conflict') : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))) : '')
async function reload() {
  if (reloading.value || isPending.value || !hydrated.value) return
  reloading.value = true
  reloadFailure.value = false
  try {
    const fresh = await props.reloadSettings()
    baseline.value = fresh
    policy.value = fresh.cancellation_policy
    failure.value = null
  } catch { reloadFailure.value = true } finally { reloading.value = false }
}
async function submit() {
  if (!hydrated.value || isPending.value || reloading.value || !props.canEdit || !dirty.value || conflict.value) return
  failure.value = null
  try {
    const saved = await save({ cancellation_policy: policy.value, revision: baseline.value.revision })
    baseline.value = saved
    policy.value = saved.cancellation_policy
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm novalidate :state="{ policy }" class="liwan-form" method="post" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('hr.leaveSettings.title')" :description="t('hr.leaveSettings.hint')">
      <UAlert v-if="message" role="alert" color="error" variant="subtle" :title="t('hr.leaveSettings.saveError')" :description="message" />
      <UButton v-if="conflict" color="neutral" variant="outline" :label="t('hr.leaveSettings.reload')" :loading="reloading" :disabled="!hydrated || reloading" @click="reload" />
      <UAlert v-if="reloadFailure" role="alert" color="error" variant="subtle" :title="t('hr.leaveSettings.reloadError')" />
      <UFormField :label="t('hr.leaveSettings.reference')" name="leave-cancellation-policy" :help="t('hr.leaveSettings.defaultHint')">
        <USelect id="leave-cancellation-policy" v-model="policy" class="w-full" :items="items" :disabled="!hydrated || !props.canEdit || isPending || reloading" />
      </UFormField>
      <p class="text-sm text-muted">{{ t('hr.leaveSettings.managerApprovalHint') }}</p>
      <p class="text-sm text-muted">{{ t('hr.leaveSettings.directEmployeeHint') }}</p>
      <p class="text-sm text-muted">{{ t('hr.leaveSettings.managerOnlyHint') }}</p>
    </SharedFormSection>
    <SharedFormActions v-if="props.canEdit">
      <UButton type="submit" class="ms-auto" :loading="isPending" :disabled="!hydrated || isPending || reloading || !dirty || conflict" :label="t('app.saveChanges')" />
    </SharedFormActions>
  </UForm>
</template>
