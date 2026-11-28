<script setup lang="ts">
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { TelephonyRecordingSettingsSchema, type TelephonyRecordingSettings } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

/*
 * The recording card of the telephony settings (DESIGN.md §6): whether the database records its calls, whether the party
 * that answers hears the notice once it answers, and how many days the agent keeps a recording. The card reads the
 * current settings and saves the three fields in one PATCH; a user without `telephony.manage` reads them disabled.
 * The policy is one per database, so only a manager of the root company may change it: the server refuses (403) a
 * manager of any other company, and the card then stays read-only and names who may change it.
 */
const SETTINGS = ['telephony', 'settings'] as const
// The card is drawn only once the GET answered, so this placeholder is never shown and never sent: it is the draft's
// shape while the page state shows loading.
const UNREAD: TelephonyRecordingSettings = { recordingPolicy: 'off', recordingAnnouncement: false, recordingRetentionDays: 1 }

const props = defineProps<{ id: string; canEdit: boolean }>()
const { t } = useI18n()
const { $api } = useApi()
const hydrated = useHydrated()
const queryClient = useQueryClient()

const settings = useQuery({
  queryKey: SETTINGS,
  queryFn: ({ signal }) => $api('/api/v1/telephony/settings', { schema: TelephonyRecordingSettingsSchema, signal }),
})

// A scope refusal (403) holds until another session loads the page: the policy of this database does not change with
// the draft, so the card stays read-only and shows who may change it instead of the class of the refusal.
const denied = ref(false)

const { draft, state, save, revert, reload } = useSettingsForm<TelephonyRecordingSettings, TelephonyRecordingSettings>({
  source: () => settings.data.value ?? UNREAD,
  read: source => ({ ...source }),
  save: async (values) => {
    try {
      const saved = await $api('/api/v1/telephony/settings', {
        method: 'PATCH',
        body: { recordingPolicy: values.recordingPolicy, recordingAnnouncement: values.recordingAnnouncement, recordingRetentionDays: values.recordingRetentionDays },
        schema: TelephonyRecordingSettingsSchema,
      })
      queryClient.setQueryData(SETTINGS, saved)
      return saved
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) denied.value = true
      throw error
    }
  },
  reload: async () => {
    const result = await settings.refetch()
    if (result.isError) throw result.error
    return result.data ?? UNREAD
  },
})

const locked = computed(() => !hydrated.value || !props.canEdit || denied.value || state.value.saving || state.value.reloading)
const cardState = computed(() => ({ ...state.value, message: denied.value ? t('telephony.settings.recordingForbidden') : state.value.message }))
const policyItems = computed(() => [
  { value: 'always' as const, label: t('telephony.settings.recordingPolicyAlways'), description: t('telephony.settings.recordingPolicyAlwaysHint') },
  { value: 'off' as const, label: t('telephony.settings.recordingPolicyOff'), description: t('telephony.settings.recordingPolicyOffHint') },
])
</script>

<template>
  <SharedSettingsCard
    :id="id"
    v-bind="cardState"
    :title="t('telephony.settings.recording')"
    :description="t('telephony.settings.recordingHint')"
    :can-edit="canEdit"
    data-testid="telephony-recording-card"
    @save="save"
    @revert="revert"
    @reload="reload"
  >
    <SharedPageState :loading="settings.isLoading.value" :error="settings.data.value ? null : settings.error.value" @retry="settings.refetch">
      <SharedSettingRow stacked :label="t('telephony.settings.recordingPolicy')" :description="t('telephony.settings.recordingPolicyHint')">
        <SharedOptionCards v-model="draft.recordingPolicy" :options="policyItems" :label="t('telephony.settings.recordingPolicy')" :disabled="locked" data-testid="telephony-recording-policy" />
      </SharedSettingRow>
      <SharedSettingRow :label="t('telephony.settings.recordingAnnouncement')" :description="t('telephony.settings.recordingAnnouncementHint')">
        <USwitch v-model="draft.recordingAnnouncement" :aria-label="t('telephony.settings.recordingAnnouncement')" :disabled="locked" data-testid="telephony-recording-announcement" />
      </SharedSettingRow>
      <UFormField :label="t('telephony.settings.recordingRetentionDays')" :help="t('telephony.settings.recordingRetentionDaysHint')" name="recording-retention-days">
        <UInputNumber id="recording-retention-days" v-model="draft.recordingRetentionDays" class="w-full" :min="1" :max="3650" :disabled="locked" data-testid="telephony-recording-retention-days" />
      </UFormField>
    </SharedPageState>
  </SharedSettingsCard>
</template>
