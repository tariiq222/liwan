<script setup lang="ts">
import type { CrmSettings } from '@webvue/contracts'
import { useCrmSettingsCard } from '@/composables/crm/useCrmSettingsCard'

const props = defineProps<{ settings: CrmSettings; canEdit: boolean; reloadSettings: () => Promise<CrmSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useCrmSettingsCard({
  settings: () => props.settings,
  read: ({ followup_attempts, followup_interval_hours, after_attempts, recycle_enabled, recycle_after_days, recycle_cycles }) => (
    { followup_attempts, followup_interval_hours, after_attempts, recycle_enabled, recycle_after_days, recycle_cycles }
  ),
  toPatch: values => ({ values }),
  reload: () => props.reloadSettings(),
})
const range = computed(() => props.settings.options)
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const afterItems = computed(() => [
  { value: 'lost', label: t('crm.settings.followup.afterLost') },
  { value: 'manager', label: t('crm.settings.followup.afterManager') },
])
</script>

<template>
  <SharedSettingsCard id="followup" v-bind="state" :title="t('crm.settings.followup.title')" :description="t('crm.settings.followup.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('crm.settings.followup.attempts')" name="followup-attempts" :description="t('crm.settings.followup.attemptsHint')">
      <UInputNumber id="followup-attempts" v-model="draft.followup_attempts" class="w-full" :min="range.followup_attempts.min" :max="range.followup_attempts.max" :disabled="locked" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('crm.settings.followup.interval')" name="followup-interval" :description="t('crm.settings.followup.intervalHint')">
      <UInputNumber id="followup-interval" v-model="draft.followup_interval_hours" class="w-full" :min="range.followup_interval_hours.min" :max="range.followup_interval_hours.max" :disabled="locked" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('crm.settings.followup.afterAttempts')" name="after-attempts" :description="t('crm.settings.followup.afterAttemptsHint')">
      <USelect id="after-attempts" v-model="draft.after_attempts" class="w-full" :items="afterItems" :disabled="locked" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('crm.settings.followup.recycle')" :description="t('crm.settings.followup.recycleHint')">
      <USwitch v-model="draft.recycle_enabled" :disabled="locked" :aria-label="t('crm.settings.followup.recycle')" />
    </UFormField>
    <template v-if="draft.recycle_enabled">
      <UFormField orientation="horizontal" :label="t('crm.settings.followup.recycleAfterDays')" name="recycle-after-days">
        <UInputNumber id="recycle-after-days" v-model="draft.recycle_after_days" class="w-full" :min="range.recycle_after_days.min" :max="range.recycle_after_days.max" :disabled="locked" />
      </UFormField>
      <UFormField orientation="horizontal" :label="t('crm.settings.followup.recycleCycles')" name="recycle-cycles" :description="t('crm.settings.followup.recycleCyclesHint')">
        <UInputNumber id="recycle-cycles" v-model="draft.recycle_cycles" class="w-full" :min="range.recycle_cycles.min" :max="range.recycle_cycles.max" :disabled="locked" />
      </UFormField>
    </template>
  </SharedSettingsCard>
</template>
