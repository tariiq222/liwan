<script setup lang="ts">
import type { CrmSettings } from '@liwan/contracts'
import { useCrmSettingsCard } from '@/composables/crm/useCrmSettingsCard'
import { useCrmStageChoices } from '@/composables/crm/useCrmLists'

const props = defineProps<{ settings: CrmSettings; canEdit: boolean; reloadSettings: () => Promise<CrmSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useCrmSettingsCard({
  settings: () => props.settings,
  read: ({ distribution_mode, distribution_user_ids, start_stage_mode, start_stage_id }) => (
    { distribution_mode, distribution_user_ids, start_stage_mode, start_stage_id }
  ),
  toPatch: values => ({ values }),
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const modeItems = computed(() => [
  { value: 'round_robin', label: t('crm.settings.distribution.roundRobin') },
  { value: 'manual', label: t('crm.settings.distribution.manual') },
  { value: 'on_import', label: t('crm.settings.distribution.onImport') },
])
const modeHint = computed(() => ({
  round_robin: t('crm.settings.distribution.roundRobinHint'),
  manual: t('crm.settings.distribution.manualHint'),
  on_import: t('crm.settings.distribution.onImportHint'),
})[draft.value.distribution_mode])
const members = computed({
  get: () => draft.value.distribution_user_ids,
  set: (ids: number | number[] | null) => { draft.value.distribution_user_ids = Array.isArray(ids) ? ids : [] },
})
const startModeItems = computed(() => [
  { value: 'auto', label: t('crm.settings.distribution.startStageAuto') },
  { value: 'stage', label: t('crm.settings.distribution.startStageChosen') },
])
// The active open stages, from the same choices the record page's stage selector reads; a chosen
// stage the company later archives or marks as won is refused by the server on the next save, and
// the legacy rule takes over at runtime until then.
const stages = useCrmStageChoices()
const stageItems = computed(() => (stages.data.value?.items ?? [])
  .filter(stage => stage.active && !stage.is_won)
  .map(stage => ({ value: stage.id, label: stage.name })))
</script>

<template>
  <SharedSettingsCard id="distribution" v-bind="state" :title="t('crm.settings.distribution.title')" :description="t('crm.settings.distribution.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <SharedSettingRow :label="t('crm.settings.distribution.mode')" name="distribution-mode" :description="modeHint">
      <USelect id="distribution-mode" v-model="draft.distribution_mode" class="w-full min-w-44" :items="modeItems" :disabled="locked" />
    </SharedSettingRow>
    <SharedSettingRow :label="t('crm.settings.distribution.members')" name="distribution-members" :description="t('crm.settings.distribution.membersHint')">
      <SharedPersonPicker id="distribution-members" v-model="members" multiple value-key="user_id" :known="props.settings.distribution_users" :disabled="locked" />
    </SharedSettingRow>
    <SharedSettingRow :label="t('crm.settings.distribution.startStage')" name="start-stage-mode" :description="t('crm.settings.distribution.startStageHint')">
      <USelect id="start-stage-mode" v-model="draft.start_stage_mode" class="w-full min-w-44" :items="startModeItems" :disabled="locked" />
    </SharedSettingRow>
    <SharedSettingRow v-if="draft.start_stage_mode === 'stage'" :label="t('crm.settings.distribution.startStageChosen')" name="start-stage-id">
      <USelect id="start-stage-id" :model-value="draft.start_stage_id ?? undefined" class="w-full min-w-44" :items="stageItems" :disabled="locked" @update:model-value="value => (draft.start_stage_id = value ?? null)" />
    </SharedSettingRow>
  </SharedSettingsCard>
</template>
