<script setup lang="ts">
import { InboxSettingsPatchSchema, type InboxAssignmentPolicy, type InboxVisibilityPolicy } from '@webvue/contracts'
import { useInboxSettings, useUpdateInboxSettings } from '@/composables/inbox/useInboxSettings'

// Visibility, automatic closing, retention, who gets new conversations and the first-response alert: the tenant-wide
// policies of the inbox. The server enforces the
// visibility policy on every read, reply, export and download; this form only chooses it.
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { data, isLoading, error, refetch } = useInboxSettings()
const { mutate: save, isPending } = useUpdateInboxSettings()

const POLICIES: readonly InboxVisibilityPolicy[] = ['assigned_only', 'department', 'all']
const ASSIGNMENTS: readonly InboxAssignmentPolicy[] = ['manual', 'round_robin', 'least_open']
const visibility = ref<InboxVisibilityPolicy>('department')
const assignment = ref<InboxAssignmentPolicy>('manual')
const alertMinutes = ref(0)
const autoClose = ref(72)
const retention = ref(24)
watch(data, (settings) => {
  if (!settings) return
  visibility.value = settings.visibility_policy
  autoClose.value = settings.auto_close_hours
  retention.value = settings.retention_months
  assignment.value = settings.assignment_policy
  alertMinutes.value = settings.first_response_alert_minutes
}, { immediate: true })

const draft = computed(() => ({
  visibility_policy: visibility.value, auto_close_hours: autoClose.value, retention_months: retention.value,
  assignment_policy: assignment.value, first_response_alert_minutes: alertMinutes.value,
}))
const dirty = computed(() => !!data.value && JSON.stringify(draft.value) !== JSON.stringify({
  visibility_policy: data.value.visibility_policy, auto_close_hours: data.value.auto_close_hours, retention_months: data.value.retention_months,
  assignment_policy: data.value.assignment_policy, first_response_alert_minutes: data.value.first_response_alert_minutes,
}))
const valid = computed(() => InboxSettingsPatchSchema.safeParse(draft.value).success)
const policyItems = computed(() => POLICIES.map(value => ({ value, label: t(`inbox.settings.policy.visibility.${value}`), description: t(`inbox.settings.policy.visibilityHint.${value}`) })))

const assignmentItems = computed(() => ASSIGNMENTS.map(value => ({ value, label: t(`inbox.settings.policy.assignment.${value}`), description: t(`inbox.settings.policy.assignmentHint.${value}`) })))

function submit() {
  if (!hydrated.value || !dirty.value || !valid.value) return
  save(draft.value, {
    onSuccess: () => toast.add({ title: t('inbox.settings.saved'), color: 'success' }),
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <SharedFormSection id="policy" panel class="webvue-settings-anchor" :title="t('inbox.settings.policy.title')" :description="t('inbox.settings.policy.hint')">
    <SharedLoadingSkeleton v-if="isLoading" />
    <SharedPageState v-else-if="error" :error="error" @retry="refetch()" />
    <form v-else class="flex flex-col gap-5" novalidate @submit.prevent="submit">
      <SharedUnsavedChanges :dirty="dirty" />
      <UFormField :label="t('inbox.settings.policy.visibilityLabel')" :description="t('inbox.settings.policy.visibilityDescription')">
        <URadioGroup v-model="visibility" :items="policyItems" :disabled="!hydrated || isPending" data-testid="inbox-visibility" />
      </UFormField>
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField :label="t('inbox.settings.policy.autoClose')" :description="t('inbox.settings.policy.autoCloseHint')">
          <UInputNumber v-model="autoClose" class="w-full" :min="0" :max="720" :disabled="!hydrated || isPending" data-testid="inbox-auto-close" />
        </UFormField>
        <UFormField :label="t('inbox.settings.policy.retention')" :description="t('inbox.settings.policy.retentionHint')">
          <UInputNumber v-model="retention" class="w-full" :min="1" :max="120" :disabled="!hydrated || isPending" data-testid="inbox-retention" />
        </UFormField>
      </div>
      <UFormField :label="t('inbox.settings.policy.assignmentLabel')" :description="t('inbox.settings.policy.assignmentDescription')">
        <URadioGroup v-model="assignment" :items="assignmentItems" :disabled="!hydrated || isPending" data-testid="inbox-assignment" />
      </UFormField>
      <UFormField :label="t('inbox.settings.policy.firstResponse')" :description="t('inbox.settings.policy.firstResponseHint')">
        <UInputNumber v-model="alertMinutes" class="w-full sm:w-60" :min="0" :max="1440" :disabled="!hydrated || isPending" data-testid="inbox-first-response" />
      </UFormField>
      <div class="flex justify-end">
        <UButton type="submit" :disabled="!hydrated || !dirty || !valid" :loading="isPending" :label="t('app.save')" data-testid="inbox-policy-save" />
      </div>
    </form>
  </SharedFormSection>
</template>
