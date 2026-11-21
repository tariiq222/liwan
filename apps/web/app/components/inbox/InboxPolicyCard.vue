<script setup lang="ts">
import { InboxSettingsPatchSchema, type InboxAssignmentPolicy, type InboxSettings, type InboxUnavailableRelease, type InboxVisibilityPolicy } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useInboxAutomationEnabled } from '@/composables/inbox/inboxFeatures'
import { useUpdateInboxSettings } from '@/composables/inbox/useInboxSettings'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// Visibility, automatic closing, retention, who gets new conversations and the first-response alert: the tenant-wide
// policies of the inbox. The server enforces the visibility policy on every read, reply, export and download; this
// card only chooses it. The card saves through the settings page's one save bar.
const props = defineProps<{ settings: InboxSettings; canEdit: boolean; reloadSettings: () => Promise<InboxSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: saveSettings } = useUpdateInboxSettings()
// The assignment policy and the first-response alert are part of the automation sub-feature: without it they take no
// effect and the server refuses a change, so the two fields stay visible but locked, with the reason beside them.
const automationOn = useInboxAutomationEnabled()

const POLICIES: readonly InboxVisibilityPolicy[] = ['assigned_only', 'department', 'all']
const ASSIGNMENTS: readonly InboxAssignmentPolicy[] = ['manual', 'round_robin', 'least_open']
const RELEASES: readonly InboxUnavailableRelease[] = ['keep', 'release']

const { draft, state, save, revert, reload } = useSettingsForm<InboxSettings, InboxSettings>({
  source: () => props.settings,
  read: settings => ({ ...settings }),
  save: (values) => {
    if (!InboxSettingsPatchSchema.safeParse(values).success) throw new ApiError(422, 'invalid', t('errors.generic'))
    return saveSettings(values)
  },
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const automationLocked = computed(() => locked.value || !automationOn.value)
const automationReason = computed(() => (automationOn.value ? undefined : t('inbox.settings.policy.automationLocked')))
const policyItems = computed(() => POLICIES.map(value => ({ value, label: t(`inbox.settings.policy.visibility.${value}`), description: t(`inbox.settings.policy.visibilityHint.${value}`) })))
const assignmentItems = computed(() => ASSIGNMENTS.map(value => ({ value, label: t(`inbox.settings.policy.assignment.${value}`), description: t(`inbox.settings.policy.assignmentHint.${value}`) })))
const releaseItems = computed(() => RELEASES.map(value => ({ value, label: t(`inbox.settings.policy.release.${value}`), description: t(`inbox.settings.policy.releaseHint.${value}`) })))
</script>

<template>
  <SharedSettingsCard id="policy" v-bind="state" :title="t('inbox.settings.policy.title')" :description="t('inbox.settings.policy.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <SharedSettingRow stacked :label="t('inbox.settings.policy.visibilityLabel')" :description="t('inbox.settings.policy.visibilityDescription')">
      <SharedOptionCards v-model="draft.visibility_policy" :options="policyItems" :label="t('inbox.settings.policy.visibilityLabel')" :disabled="locked" data-testid="inbox-visibility" />
    </SharedSettingRow>
    <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
      <UFormField :label="t('inbox.settings.policy.autoClose')" name="inbox-auto-close" :help="t('inbox.settings.policy.autoCloseHint')">
        <UInputNumber id="inbox-auto-close" v-model="draft.auto_close_hours" class="w-full" :min="0" :max="720" :disabled="locked" data-testid="inbox-auto-close" />
      </UFormField>
      <UFormField :label="t('inbox.settings.policy.retention')" name="inbox-retention" :help="t('inbox.settings.policy.retentionHint')">
        <UInputNumber id="inbox-retention" v-model="draft.retention_months" class="w-full" :min="1" :max="120" :disabled="locked" data-testid="inbox-retention" />
      </UFormField>
      <UFormField :label="t('inbox.settings.policy.reportRetention')" name="inbox-report-retention" :help="t('inbox.settings.policy.reportRetentionHint')">
        <UInputNumber id="inbox-report-retention" v-model="draft.report_retention_months" class="w-full" :min="12" :max="120" :disabled="locked" data-testid="inbox-report-retention" />
      </UFormField>
      <UFormField :label="t('inbox.settings.policy.firstResponse')" name="inbox-first-response" :help="automationReason ?? t('inbox.settings.policy.firstResponseHint')">
        <UInputNumber id="inbox-first-response" v-model="draft.first_response_alert_minutes" class="w-full" :min="0" :max="1440" :disabled="automationLocked" data-testid="inbox-first-response" />
      </UFormField>
    </div>
    <SharedSettingRow stacked :label="t('inbox.settings.policy.assignmentLabel')" :description="t('inbox.settings.policy.assignmentDescription')" :disabled-reason="automationReason">
      <SharedOptionCards v-model="draft.assignment_policy" :options="assignmentItems" :label="t('inbox.settings.policy.assignmentLabel')" :disabled="automationLocked" data-testid="inbox-assignment" />
    </SharedSettingRow>
    <SharedSettingRow :label="t('inbox.settings.policy.shifts')" :description="t('inbox.settings.policy.shiftsHint')">
      <USwitch v-model="draft.agent_shifts_enabled" :aria-label="t('inbox.settings.policy.shifts')" :disabled="locked" data-testid="inbox-agent-shifts-enabled" />
    </SharedSettingRow>
    <SharedSettingRow stacked :label="t('inbox.settings.policy.releaseLabel')" :description="t('inbox.settings.policy.releaseDescription')">
      <SharedOptionCards v-model="draft.unavailable_release" :options="releaseItems" :label="t('inbox.settings.policy.releaseLabel')" :disabled="locked" data-testid="inbox-unavailable-release" />
    </SharedSettingRow>
  </SharedSettingsCard>
</template>
