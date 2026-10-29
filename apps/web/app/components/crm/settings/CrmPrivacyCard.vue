<script setup lang="ts">
import type { CrmSettings } from '@webvue/contracts'
import { useCrmSettingsCard } from '@/composables/crm/useCrmSettingsCard'

const props = defineProps<{ settings: CrmSettings; canEdit: boolean; reloadSettings: () => Promise<CrmSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useCrmSettingsCard({
  settings: () => props.settings,
  read: ({ visibility, view_log_enabled }) => ({ visibility, view_log_enabled }),
  toPatch: values => ({ values }),
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const visibilityItems = computed(() => [
  { value: 'own', label: t('crm.settings.privacy.own') },
  { value: 'team', label: t('crm.settings.privacy.team') },
  { value: 'all', label: t('crm.settings.privacy.all') },
])
const visibilityHint = computed(() => ({
  own: t('crm.settings.privacy.ownHint'),
  team: t('crm.settings.privacy.teamHint'),
  all: t('crm.settings.privacy.allHint'),
})[draft.value.visibility])
</script>

<template>
  <SharedSettingsCard id="privacy" v-bind="state" :title="t('crm.settings.privacy.title')" :description="t('crm.settings.privacy.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('crm.settings.privacy.visibility')" name="visibility" :description="visibilityHint">
      <USelect id="visibility" v-model="draft.visibility" class="w-full" :items="visibilityItems" :disabled="locked" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('crm.settings.privacy.viewLog')" :description="t('crm.settings.privacy.viewLogHint')">
      <USwitch v-model="draft.view_log_enabled" :disabled="locked" :aria-label="t('crm.settings.privacy.viewLog')" />
    </UFormField>
  </SharedSettingsCard>
</template>
