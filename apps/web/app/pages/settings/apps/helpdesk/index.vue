<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { HelpdeskSettings } from '@liwan/contracts'
import { useHelpdeskReference, useHelpdeskSettings, useSaveHelpdeskSettings } from '@/composables/helpdesk/useHelpdesk'
import { useHelpdeskResources } from '@/composables/helpdesk/useHelpdeskResources'
import { useHelpdeskSla } from '@/composables/helpdesk/useHelpdeskSla'
import HelpdeskSlaSection from '@/components/helpdesk/settings/HelpdeskSlaSection.vue'
import HelpdeskStagesSection from '@/components/helpdesk/settings/HelpdeskStagesSection.vue'
import HelpdeskTeamsSection from '@/components/helpdesk/settings/HelpdeskTeamsSection.vue'
import HelpdeskValueListSection from '@/components/helpdesk/settings/HelpdeskValueListSection.vue'

// The Support Desk settings under Settings > Applications: one card for the policy a tenant shapes without code —
// who sees which ticket, the defaults of a new ticket, the reference prefix of its number, the reopen window and the
// response targets the counters measure. Reading needs `helpdesk.settings.read`, saving `helpdesk.settings.manage`.
const { t } = useI18n()
const { parts } = useSettingsPage('helpdesk')
const { can } = useAccess()
// Nothing is typed into a control the server rendered with another value: the page edits once it is hydrated.
const hydrated = useHydrated()
const settings = useHelpdeskSettings()
const reference = useHelpdeskReference()
const resources = useHelpdeskResources(() => can('helpdesk.settings.read'))
const sla = useHelpdeskSla(() => can('helpdesk.settings.read'))
const save = useSaveHelpdeskSettings()
const message = ref('')

type Draft = Pick<HelpdeskSettings, 'preset' | 'visibility' | 'default_team_id' | 'default_priority'
  | 'reference_prefix' | 'reopen_days' | 'first_response_hours' | 'resolution_hours' | 'portal_enabled'
  | 'auto_close_days' | 'auto_close_stage_ids'>
const draft = reactive<Draft>({
  preset: 'general',
  visibility: 'team',
  default_team_id: null,
  default_priority: '1',
  reference_prefix: 'HD',
  reopen_days: 7,
  first_response_hours: 8,
  resolution_hours: 72,
  portal_enabled: true,
  auto_close_days: 0,
  auto_close_stage_ids: [] as number[],
  // The number inputs hand back `number | null`; the server refuses null, so null means zero here.
})
const revision = ref(0)

watch(() => settings.data.value, (value) => {
  if (!value) return
  Object.assign(draft, {
    preset: value.preset,
    visibility: value.visibility,
    default_team_id: value.default_team_id,
    default_priority: value.default_priority,
    reference_prefix: value.reference_prefix,
    reopen_days: value.reopen_days,
    first_response_hours: value.first_response_hours,
    resolution_hours: value.resolution_hours,
    portal_enabled: value.portal_enabled,
    auto_close_days: value.auto_close_days,
    auto_close_stage_ids: [...value.auto_close_stage_ids],
  })
  revision.value = value.revision
}, { immediate: true })

// The stage list is copied into the draft, so it is the same list by its ids, not by identity.
const sameValue = (a: unknown, b: unknown) => Array.isArray(a) && Array.isArray(b)
  ? a.length === b.length && a.every((item, index) => item === b[index])
  : a === b
const dirty = computed(() => {
  const value = settings.data.value
  if (!value) return false
  return (Object.keys(draft) as (keyof Draft)[]).some(key => !sameValue(draft[key], value[key]))
})
const presetItems = computed(() => (settings.data.value?.options.presets ?? []).map(item => ({ value: item.value, label: t(`helpdesk.settings.presets.${item.value}`) })))
const visibilityItems = computed(() => (settings.data.value?.options.visibility ?? []).map(item => ({ value: item.value, label: t(`helpdesk.settings.visibility.${item.value}`) })))
const priorityItems = computed(() => (settings.data.value?.options.priorities ?? []).map(item => ({ value: item.value, label: t(`helpdesk.priority.${settings.data.value?.options.priority_names[item.value] ?? 'medium'}`) })))
const stageItems = computed(() => (reference.data.value?.stages ?? []).map(stage => ({ value: stage.id, label: stage.name })))
// The "no team" choice is a string: a numeric 0 is read as an empty value, so the server and the browser render it differently.
const NO_TEAM = 'none'
const teamItems = computed(() => [{ value: NO_TEAM, label: t('helpdesk.form.none') }, ...(reference.data.value?.teams ?? []).map(team => ({ value: String(team.id), label: team.name }))])
const busy = computed(() => settings.isLoading.value || save.isPending.value)
const canManage = computed(() => can('helpdesk.settings.manage'))
// What the sections may change right now: the right to manage, once the page is hydrated.
const canEditNow = computed(() => canManage.value && hydrated.value)
// Every control of the policy card is read-only without the manage key, not merely while a save is in flight.
const locked = computed(() => busy.value || !canEditNow.value)

async function submit() {
  message.value = ''
  try {
    const saved = await save.mutateAsync({ revision: revision.value, ...draft })
    revision.value = saved.revision
    message.value = t('helpdesk.settings.saved')
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : t('helpdesk.settings.failed')
  }
}
function revert() {
  settings.refetch()
  message.value = ''
}
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('helpdesk.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
      <SharedPageState :loading="settings.isLoading.value" :error="settings.data.value ? null : settings.error.value" :empty="!settings.data.value" @retry="settings.refetch">
        <!-- The draft is copied from the answer by a watcher, which the server render never re-runs: the card is drawn once hydrated. -->
        <SharedSettingsSection v-if="settings.data.value && hydrated" id="policy" :title="t('helpdesk.settings.policy')" :description="t('helpdesk.settings.policyHint')">
          <SharedSettingsCard
            id="helpdesk-policy"
            :title="t('helpdesk.settings.policyTitle')"
            :can-edit="canManage"
            :dirty="dirty"
            :saving="save.isPending.value"
            :message="message"
            @save="submit"
            @revert="revert"
          >
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
              <UInputNumber v-model="draft.reopen_days" class="w-full" :min="0" :max="90" :disabled="locked" data-testid="helpdesk-settings-reopen" />
            </UFormField>
            <UFormField :label="t('helpdesk.settings.firstResponse')" name="helpdesk-first-response" :help="t('helpdesk.settings.firstResponseHint')">
              <UInputNumber v-model="draft.first_response_hours" class="w-full" :min="0" :max="720" :disabled="locked" data-testid="helpdesk-settings-first-response" />
            </UFormField>
            <UFormField :label="t('helpdesk.settings.resolution')" name="helpdesk-resolution" :help="t('helpdesk.settings.resolutionHint')">
              <UInputNumber v-model="draft.resolution_hours" class="w-full" :min="0" :max="8760" :disabled="locked" data-testid="helpdesk-settings-resolution" />
            </UFormField>
            <UFormField :label="t('helpdesk.settings.portalEnabled')" name="helpdesk-portal" :help="t('helpdesk.settings.portalEnabledHint')">
              <USwitch v-model="draft.portal_enabled" :disabled="locked" data-testid="helpdesk-settings-portal" />
            </UFormField>
            <UFormField :label="t('helpdesk.settings.autoCloseDays')" name="helpdesk-auto-close" :help="t('helpdesk.settings.autoCloseDaysHint')">
              <UInputNumber :model-value="draft.auto_close_days" class="w-full" :min="0" :max="365" :disabled="locked" data-testid="helpdesk-settings-auto-close" @update:model-value="value => { draft.auto_close_days = Number(value ?? 0) }" />
            </UFormField>
            <UFormField :label="t('helpdesk.settings.autoCloseStages')" name="helpdesk-auto-close-stages" :help="t('helpdesk.settings.autoCloseStagesHint')">
              <USelectMenu v-model="draft.auto_close_stage_ids" :items="stageItems" multiple value-key="value" class="w-full" data-testid="helpdesk-settings-auto-close-stages" />
            </UFormField>
          </SharedSettingsCard>
        </SharedSettingsSection>
        <template v-if="resources.data.value">
          <SharedSettingsSection id="teams" :title="t('helpdesk.settings.teams.section')" :description="t('helpdesk.settings.teams.sectionHint')">
            <HelpdeskTeamsSection :rows="resources.data.value.teams" :can-edit="canEditNow" />
          </SharedSettingsSection>
          <SharedSettingsSection id="workflow" :title="t('helpdesk.settings.values.section')" :description="t('helpdesk.settings.values.sectionHint')">
            <HelpdeskStagesSection :rows="resources.data.value.stages" :teams="resources.data.value.teams" :can-edit="canEditNow" />
            <HelpdeskValueListSection kind="categories" :rows="resources.data.value.categories" :can-edit="canEditNow" />
            <HelpdeskValueListSection kind="tags" :rows="resources.data.value.tags" :can-edit="canEditNow" />
            <HelpdeskValueListSection kind="channels" :rows="resources.data.value.channels" :can-edit="canEditNow" />
            <HelpdeskValueListSection kind="types" :rows="resources.data.value.types" :can-edit="canEditNow" />
          </SharedSettingsSection>
          <SharedSettingsSection v-if="sla.data.value" id="sla" :title="t('helpdesk.settings.sla.section')" :description="t('helpdesk.settings.sla.sectionHint')">
            <HelpdeskSlaSection
              :rows="sla.data.value.items"
              :stages="resources.data.value.stages"
              :teams="resources.data.value.teams"
              :categories="resources.data.value.categories"
              :tags="resources.data.value.tags"
              :can-edit="canEditNow"
            />
          </SharedSettingsSection>
        </template>
      </SharedPageState>
    </template>
  </SharedSettingsPage>
</template>
