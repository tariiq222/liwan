<script setup lang="ts">
import type { AppointmentSettings } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { settingsPatch } from '@/composables/appointments/appointmentSettings'
import { useSaveAppointmentSettings } from '@/composables/appointments/useAppointmentSettings'
import { saveErrorMessage } from '@/utils/formFeedback'

// The sector preset is an action, not a draft: applying it writes every value of the preset at once (the server's
// `preset` patch), so choosing the preset that is already named still applies it, which restores its defaults after the
// other cards were edited. A change made elsewhere answers 409 and the manager reloads before applying.
const props = defineProps<{ settings: AppointmentSettings; canEdit: boolean; reloadSettings: () => Promise<AppointmentSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: saveSettings, isPending } = useSaveAppointmentSettings()
const chosen = ref(props.settings.sector_preset)
watch(() => props.settings.sector_preset, (preset) => { chosen.value = preset })
const failure = ref('')
const locked = computed(() => !hydrated.value || !props.canEdit || isPending.value)
const items = computed(() => props.settings.presets.map(value => ({ value, label: t(`appointments.settings.presets.${value}`) })))

async function apply() {
  if (locked.value) return
  failure.value = ''
  try {
    await saveSettings(settingsPatch(props.settings, { preset: chosen.value }))
    toast.add({ title: t('appointments.settings.preset.applied'), color: 'success' })
  } catch (error) {
    const stale = error instanceof ApiError && error.status === 409
    failure.value = stale ? t('app.settingsConflict') : saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
    if (stale) await props.reloadSettings().catch(() => undefined)
  }
}
</script>

<template>
  <SharedRecordSection id="preset" class="webvue-settings-anchor" :title="t('appointments.settings.preset.title')" :description="t('appointments.settings.preset.hint')" data-testid="appointments-preset">
    <div class="grid gap-3">
      <UFormField orientation="horizontal" :label="t('appointments.settings.preset.label')" name="sector_preset" :description="t('appointments.settings.preset.warning')">
        <USelect id="appointments-preset" v-model="chosen" class="w-full" :items="items" :disabled="locked" />
      </UFormField>
      <UAlert v-if="failure" color="error" variant="subtle" role="alert" :description="failure" />
      <div v-if="canEdit" class="flex justify-end">
        <UButton type="button" :loading="isPending" :disabled="locked" :label="t('appointments.settings.preset.apply')" data-testid="appointments-preset-apply" @click="apply" />
      </div>
    </div>
  </SharedRecordSection>
</template>
