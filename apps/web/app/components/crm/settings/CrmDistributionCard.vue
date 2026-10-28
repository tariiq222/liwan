<script setup lang="ts">
import type { CrmSettings } from '@webvue/contracts'
import { useCrmSettingsCard } from '@/composables/crm/useCrmSettingsCard'

const props = defineProps<{ settings: CrmSettings; canEdit: boolean; reloadSettings: () => Promise<CrmSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, shell, save, reload } = useCrmSettingsCard({
  settings: () => props.settings,
  read: ({ distribution_mode, distribution_user_ids }) => ({ distribution_mode, distribution_user_ids }),
  toPatch: values => ({ values }),
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || shell.value.saving || shell.value.reloading)
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
</script>

<template>
  <CrmSettingsCard v-bind="shell" :title="t('crm.settings.distribution.title')" :description="t('crm.settings.distribution.hint')" :can-edit="canEdit" @save="save" @reload="reload">
    <UFormField :label="t('crm.settings.distribution.mode')" name="distribution-mode" :help="modeHint">
      <USelect id="distribution-mode" v-model="draft.distribution_mode" class="w-full" :items="modeItems" :disabled="locked" />
    </UFormField>
    <UFormField :label="t('crm.settings.distribution.members')" name="distribution-members" :help="t('crm.settings.distribution.membersHint')">
      <SharedPersonPicker id="distribution-members" v-model="members" multiple value-key="user_id" :known="props.settings.distribution_users" :disabled="locked" />
    </UFormField>
  </CrmSettingsCard>
</template>
