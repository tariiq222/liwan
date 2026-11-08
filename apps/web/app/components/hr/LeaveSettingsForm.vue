<script setup lang="ts">
import type { HrLeaveSettings } from '@liwan/contracts'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// The company policy for cancelling an approved leave. It saves with the revision the manager read: a save after
// someone else's answers 409, keeps the draft and locks the card until the current policy is reloaded.
const props = defineProps<{ settings: HrLeaveSettings; canEdit: boolean; reloadSettings: () => Promise<HrLeaveSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: saveSettings } = useSaveHrLeaveSettings()

type Draft = { cancellation_policy: HrLeaveSettings['cancellation_policy'] }
const { draft, state, save, revert, reload } = useSettingsForm<HrLeaveSettings, Draft>({
  source: () => props.settings,
  read: ({ cancellation_policy }) => ({ cancellation_policy }),
  save: (values, latest) => saveSettings({ cancellation_policy: values.cancellation_policy, revision: latest.revision }),
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading || state.value.conflict)
const items = computed(() => [
  { value: 'manager_approval', label: t('hr.leaveSettings.managerApproval') },
  { value: 'direct_employee', label: t('hr.leaveSettings.directEmployee') },
  { value: 'manager_only', label: t('hr.leaveSettings.managerOnly') },
])
async function submit() {
  if (!hydrated.value || !props.canEdit) return
  await save()
}
</script>

<template>
  <SharedSettingsCard id="leave-policy" v-bind="state" :title="t('hr.leaveSettings.title')" :description="t('hr.leaveSettings.hint')" :can-edit="canEdit" @save="submit" @revert="revert" @reload="reload">
    <SharedSettingRow :label="t('hr.leaveSettings.reference')" name="leave-cancellation-policy" :description="t('hr.leaveSettings.defaultHint')">
      <USelect id="leave-cancellation-policy" v-model="draft.cancellation_policy" class="w-full" :items="items" :disabled="locked" />
    </SharedSettingRow>
    <p class="text-sm text-muted">{{ t('hr.leaveSettings.managerApprovalHint') }}</p>
    <p class="text-sm text-muted">{{ t('hr.leaveSettings.directEmployeeHint') }}</p>
    <p class="text-sm text-muted">{{ t('hr.leaveSettings.managerOnlyHint') }}</p>
  </SharedSettingsCard>
</template>
