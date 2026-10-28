<script setup lang="ts">
import type { CrmSettings } from '@webvue/contracts'
import { useCrmSettingsCard } from '@/composables/crm/useCrmSettingsCard'

const props = defineProps<{ settings: CrmSettings; canEdit: boolean; reloadSettings: () => Promise<CrmSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, shell, save, reload } = useCrmSettingsCard({
  settings: () => props.settings,
  read: ({ followup_attempts, followup_interval_hours, after_attempts, recycle_enabled, recycle_after_days, recycle_cycles }) => (
    { followup_attempts, followup_interval_hours, after_attempts, recycle_enabled, recycle_after_days, recycle_cycles }
  ),
  toPatch: values => ({ values }),
  reload: () => props.reloadSettings(),
})
const range = computed(() => props.settings.options)
const locked = computed(() => !hydrated.value || !props.canEdit || shell.value.saving || shell.value.reloading)
const afterItems = computed(() => [
  { value: 'lost', label: t('crm.settings.followup.afterLost') },
  { value: 'manager', label: t('crm.settings.followup.afterManager') },
])
</script>

<template>
  <CrmSettingsCard v-bind="shell" :title="t('crm.settings.followup.title')" :description="t('crm.settings.followup.hint')" :can-edit="canEdit" @save="save" @reload="reload">
    <UFormField :label="t('crm.settings.followup.attempts')" name="followup-attempts" :help="t('crm.settings.followup.attemptsHint')">
      <UInputNumber id="followup-attempts" v-model="draft.followup_attempts" class="w-full" :min="range.followup_attempts.min" :max="range.followup_attempts.max" :disabled="locked" />
    </UFormField>
    <UFormField :label="t('crm.settings.followup.interval')" name="followup-interval" :help="t('crm.settings.followup.intervalHint')">
      <UInputNumber id="followup-interval" v-model="draft.followup_interval_hours" class="w-full" :min="range.followup_interval_hours.min" :max="range.followup_interval_hours.max" :disabled="locked" />
    </UFormField>
    <UFormField :label="t('crm.settings.followup.afterAttempts')" name="after-attempts" :help="t('crm.settings.followup.afterAttemptsHint')">
      <USelect id="after-attempts" v-model="draft.after_attempts" class="w-full" :items="afterItems" :disabled="locked" />
    </UFormField>
    <USwitch v-model="draft.recycle_enabled" :label="t('crm.settings.followup.recycle')" :description="t('crm.settings.followup.recycleHint')" :disabled="locked" />
    <template v-if="draft.recycle_enabled">
      <UFormField :label="t('crm.settings.followup.recycleAfterDays')" name="recycle-after-days">
        <UInputNumber id="recycle-after-days" v-model="draft.recycle_after_days" class="w-full" :min="range.recycle_after_days.min" :max="range.recycle_after_days.max" :disabled="locked" />
      </UFormField>
      <UFormField :label="t('crm.settings.followup.recycleCycles')" name="recycle-cycles" :help="t('crm.settings.followup.recycleCyclesHint')">
        <UInputNumber id="recycle-cycles" v-model="draft.recycle_cycles" class="w-full" :min="range.recycle_cycles.min" :max="range.recycle_cycles.max" :disabled="locked" />
      </UFormField>
    </template>
  </CrmSettingsCard>
</template>
