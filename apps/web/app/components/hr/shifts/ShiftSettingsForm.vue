<script setup lang="ts">
import type { HrShiftSettings } from '@liwan/contracts'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// The calendar-day reference of the company (its timezone, or each user's) and the company's default work schedule.
// It saves with the revision the manager read: a save after someone else's answers 409, keeps the draft and locks the
// card until the current settings are reloaded.
const props = defineProps<{ settings: HrShiftSettings; canEdit: boolean; reloadSettings: () => Promise<HrShiftSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: saveSettings } = usePatchHrShiftSettings()
const schedules = useHrShiftSchedules({ active: 'true', limit: 100, offset: 0 })

type Draft = { day_reference: HrShiftSettings['day_reference']; defaultSchedule: number | undefined }
const { draft, state, save, revert, reload } = useSettingsForm<HrShiftSettings, Draft>({
  source: () => props.settings,
  read: settings => ({ day_reference: settings.day_reference, defaultSchedule: settings.default_schedule?.id }),
  save: (values, latest) => {
    const changed = values.defaultSchedule !== latest.default_schedule?.id
    return saveSettings({
      day_reference: values.day_reference,
      ...(changed && values.defaultSchedule ? { default_schedule_id: values.defaultSchedule } : {}),
      revision: latest.revision,
    })
  },
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading || state.value.conflict)
const items = computed(() => [
  { value: 'company', label: t('hr.shiftSettings.company') },
  { value: 'user', label: t('hr.shiftSettings.user') },
])
// The current default always stays selectable, even when the page of active schedules does not list it.
const scheduleItems = computed(() => {
  const listed = (schedules.data.value?.items ?? []).map(({ id, name }) => ({ value: id, label: name }))
  const current = props.settings.default_schedule
  return current && !listed.some(item => item.value === current.id) ? [{ value: current.id, label: current.name }, ...listed] : listed
})
async function submit() {
  if (!hydrated.value || !props.canEdit) return
  await save()
}
</script>

<template>
  <SharedSettingsCard id="shift-reference" v-bind="state" :title="t('hr.shiftSettings.title')" :description="t('hr.shiftSettings.hint')" :can-edit="canEdit" @save="submit" @revert="revert" @reload="reload">
    <SharedSettingRow :label="t('hr.shiftSettings.reference')" name="shift-day-reference" :description="t('hr.shiftSettings.defaultHint', { timezone: settings.company_timezone })">
      <USelect id="shift-day-reference" v-model="draft.day_reference" class="w-full" :items="items" :disabled="locked" />
    </SharedSettingRow>
    <SharedSettingRow :label="t('hr.shiftSettings.defaultSchedule')" name="shift-default-schedule" :description="t('hr.shiftSettings.defaultScheduleHint')">
      <USelect id="shift-default-schedule" v-model="draft.defaultSchedule" class="w-full" :items="scheduleItems" :disabled="locked || !scheduleItems.length" />
    </SharedSettingRow>
  </SharedSettingsCard>
</template>
