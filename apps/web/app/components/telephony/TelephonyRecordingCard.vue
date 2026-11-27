<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import type { TelephonySettings } from '@liwan/contracts'

/**
 * The recording part of the telephony settings (design section 7): the policy, the announcement, and how long a
 * recording is kept. The announcement cannot be turned off while every call is recorded, and the card says so rather
 * than letting the server refuse it afterwards.
 */
const props = defineProps<{
  settings: TelephonySettings
  canEdit: boolean
  reloadSettings: () => Promise<TelephonySettings>
}>()

const { t } = useI18n()
const { $api } = useApi()
const queryClient = useQueryClient()
const draft = ref({
  recordingPolicy: props.settings.recordingPolicy,
  announcementEnabled: props.settings.announcementEnabled,
  retentionDays: props.settings.retentionDays,
})
const saving = ref(false)
const saved = ref(false)

const announcementLocked = computed(() => draft.value.recordingPolicy === 'always')

const policyItems = computed(() => [
  { value: 'always', label: t('telephony.settings.recordingAlways') },
  { value: 'on_demand', label: t('telephony.settings.recordingOnDemand') },
  { value: 'off', label: t('telephony.settings.recordingOff') },
])

async function save() {
  saving.value = true
  saved.value = false
  try {
    const patch = {
      recordingPolicy: draft.value.recordingPolicy,
      announcementEnabled: announcementLocked.value ? true : draft.value.announcementEnabled,
      retentionDays: draft.value.retentionDays,
    }
    const result = await $api('/api/v1/telephony/settings', {
      method: 'PATCH',
      body: patch,
    })
    queryClient.setQueryData(['telephony', 'settings'], result)
    await props.reloadSettings()
    saved.value = true
  } finally {
    saving.value = false
  }
}

const dirty = computed(() =>
  draft.value.recordingPolicy !== props.settings.recordingPolicy
  || draft.value.announcementEnabled !== props.settings.announcementEnabled
  || draft.value.retentionDays !== props.settings.retentionDays,
)
</script>

<template>
  <SharedRecordSection
    id="recording"
    variant="panel"
    :title="t('telephony.settings.recording')"
    :description="t('telephony.settings.recordingHint')"
  >
    <div class="grid gap-(--liwan-gap-card)">
      <SharedSettingRow :label="t('telephony.settings.policy')" :description="t('telephony.settings.policyHint')">
        <USelect
          v-model="draft.recordingPolicy"
          :items="policyItems"
          :disabled="!canEdit"
          :aria-label="t('telephony.settings.policy')"
        />
      </SharedSettingRow>
      <SharedSettingRow :label="t('telephony.settings.announcement')" :description="t('telephony.settings.announcementHint')">
        <USwitch
          v-model="draft.announcementEnabled"
          :disabled="!canEdit || announcementLocked"
          :aria-label="t('telephony.settings.announcement')"
        />
      </SharedSettingRow>
      <SharedSettingRow :label="t('telephony.settings.retention')" :description="t('telephony.settings.retentionHint')">
        <UInput
          v-model.number="draft.retentionDays"
          type="number"
          min="1"
          max="3650"
          :disabled="!canEdit"
          :aria-label="t('telephony.settings.retention')"
          class="w-24"
        />
      </SharedSettingRow>
    </div>
    <div class="mt-(--liwan-gap-card) flex items-center justify-end gap-3">
      <span v-if="saved" class="text-sm text-success">{{ t('telephony.settings.saved') }}</span>
      <UButton :loading="saving" :disabled="!canEdit || !dirty" @click="save">
        {{ t('telephony.settings.save') }}
      </UButton>
    </div>
  </SharedRecordSection>
</template>
