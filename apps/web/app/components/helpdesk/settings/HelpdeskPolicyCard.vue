<script setup lang="ts">
import type { HelpdeskSettings, HelpdeskStageResource, HelpdeskTeamResource } from '@liwan/contracts'
import { useSaveHelpdeskSettings } from '@/composables/helpdesk/useHelpdesk'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { buildHelpdeskSettingsPatch } from '@/utils/helpdeskSettingsPatch'

// The Support Desk policy card: who sees which ticket, the defaults of a new ticket, the reference prefix of its
// number, the reopen window, the response targets, the customer page and automatic closing. Saves through the page's
// one save bar and locks on a 409 conflict until reloaded.
const props = defineProps<{
  settings: HelpdeskSettings
  stages: readonly Pick<HelpdeskStageResource, 'id' | 'name'>[]
  teams: readonly Pick<HelpdeskTeamResource, 'id' | 'name'>[]
  canEdit: boolean
  reloadSettings: () => Promise<HelpdeskSettings>
}>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: saveSettings } = useSaveHelpdeskSettings()

type Draft = Pick<HelpdeskSettings,
  | 'preset' | 'visibility' | 'default_team_id' | 'default_priority'
  | 'reference_prefix' | 'reopen_days' | 'first_response_hours' | 'resolution_hours'
  | 'portal_enabled' | 'auto_close_days' | 'auto_close_stage_ids'
>

const readDraft = (source: HelpdeskSettings): Draft => ({
  preset: source.preset,
  visibility: source.visibility,
  default_team_id: source.default_team_id,
  default_priority: source.default_priority,
  reference_prefix: source.reference_prefix,
  reopen_days: source.reopen_days,
  first_response_hours: source.first_response_hours,
  resolution_hours: source.resolution_hours,
  portal_enabled: source.portal_enabled,
  auto_close_days: source.auto_close_days,
  auto_close_stage_ids: [...source.auto_close_stage_ids],
})

const { draft, state, save, revert, reload } = useSettingsForm<HelpdeskSettings, Draft>({
  source: () => props.settings,
  read: readDraft,
  save: (values, latest) => saveSettings(buildHelpdeskSettingsPatch({
    ...values,
    reopen_days: Number(values.reopen_days ?? 0),
    first_response_hours: Number(values.first_response_hours ?? 0),
    resolution_hours: Number(values.resolution_hours ?? 0),
    auto_close_days: Number(values.auto_close_days ?? 0),
  }, latest.preset, latest.revision)),
  reload: () => props.reloadSettings(),
})

// The "no team" choice is a string: a numeric 0 is read as an empty value, so the server and the browser render it differently.
const NO_TEAM = 'none'
const presetItems = computed(() => props.settings.options.presets.map(item => ({ value: item.value, label: t(`helpdesk.settings.presets.${item.value}`) })))
const visibilityItems = computed(() => props.settings.options.visibility.map(item => ({ value: item.value, label: t(`helpdesk.settings.visibility.${item.value}`) })))
const priorityItems = computed(() => props.settings.options.priorities.map(item => ({ value: item.value, label: t(`helpdesk.priority.${props.settings.options.priority_names[item.value] ?? 'medium'}`) })))
const stageItems = computed(() => props.stages.map(stage => ({ value: stage.id, label: stage.name })))
const teamItems = computed(() => [{ value: NO_TEAM, label: t('helpdesk.form.none') }, ...props.teams.map(team => ({ value: String(team.id), label: team.name }))])
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading || state.value.conflict)
</script>

<template>
  <SharedSettingsCard
    id="helpdesk-policy"
    v-bind="state"
    :title="t('helpdesk.settings.policyTitle')"
    :can-edit="canEdit"
    @save="save"
    @revert="revert"
    @reload="reload"
  >
    <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
      <UFormField :label="t('helpdesk.settings.preset')" name="helpdesk-preset" :help="t('helpdesk.settings.presetHint')">
        <USelect v-model="draft.preset" class="w-full" :items="presetItems" :disabled="locked" data-testid="helpdesk-settings-preset" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.visibilityLabel')" name="helpdesk-visibility" :help="t('helpdesk.settings.visibilityHint')">
        <USelect v-model="draft.visibility" class="w-full" :items="visibilityItems" :disabled="locked" data-testid="helpdesk-settings-visibility" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.defaultTeam')" name="helpdesk-team">
        <USelect :model-value="draft.default_team_id === null ? NO_TEAM : String(draft.default_team_id)" class="w-full" :items="teamItems" :disabled="locked" data-testid="helpdesk-settings-team" @update:model-value="value => { draft.default_team_id = value === NO_TEAM ? null : Number(value) }" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.defaultPriority')" name="helpdesk-priority">
        <USelect v-model="draft.default_priority" class="w-full" :items="priorityItems" :disabled="locked" data-testid="helpdesk-settings-priority" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.prefix')" name="helpdesk-prefix" :help="t('helpdesk.settings.prefixHint')">
        <UInput v-model="draft.reference_prefix" class="w-full" :maxlength="10" :disabled="locked" data-testid="helpdesk-settings-prefix" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.reopenDays')" name="helpdesk-reopen" :help="t('helpdesk.settings.reopenHint')">
        <UInputNumber :model-value="draft.reopen_days" class="w-full" :min="0" :max="90" :disabled="locked" data-testid="helpdesk-settings-reopen" @update:model-value="value => { draft.reopen_days = Number(value ?? 0) }" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.firstResponse')" name="helpdesk-first-response" :help="t('helpdesk.settings.firstResponseHint')">
        <UInputNumber :model-value="draft.first_response_hours" class="w-full" :min="0" :max="720" :disabled="locked" data-testid="helpdesk-settings-first-response" @update:model-value="value => { draft.first_response_hours = Number(value ?? 0) }" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.resolution')" name="helpdesk-resolution" :help="t('helpdesk.settings.resolutionHint')">
        <UInputNumber :model-value="draft.resolution_hours" class="w-full" :min="0" :max="8760" :disabled="locked" data-testid="helpdesk-settings-resolution" @update:model-value="value => { draft.resolution_hours = Number(value ?? 0) }" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.autoCloseDays')" name="helpdesk-auto-close" :help="t('helpdesk.settings.autoCloseDaysHint')">
        <UInputNumber :model-value="draft.auto_close_days" class="w-full" :min="0" :max="365" :disabled="locked" data-testid="helpdesk-settings-auto-close" @update:model-value="value => { draft.auto_close_days = Number(value ?? 0) }" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.autoCloseStages')" name="helpdesk-auto-close-stages" :help="t('helpdesk.settings.autoCloseStagesHint')">
        <USelectMenu v-model="draft.auto_close_stage_ids" :items="stageItems" multiple value-key="value" class="w-full" :disabled="locked" data-testid="helpdesk-settings-auto-close-stages" />
      </UFormField>
    </div>
    <SharedSettingRow :label="t('helpdesk.settings.portalEnabled')" :description="t('helpdesk.settings.portalEnabledHint')">
      <USwitch v-model="draft.portal_enabled" :aria-label="t('helpdesk.settings.portalEnabled')" :disabled="locked" data-testid="helpdesk-settings-portal" />
    </SharedSettingRow>
  </SharedSettingsCard>
</template>
