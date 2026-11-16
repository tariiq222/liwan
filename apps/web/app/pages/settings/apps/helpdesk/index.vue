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
const settings = useHelpdeskSettings()
const reference = useHelpdeskReference()
const resources = useHelpdeskResources(() => can('helpdesk.settings.read'))
const sla = useHelpdeskSla(() => can('helpdesk.settings.read'))
const save = useSaveHelpdeskSettings()
const message = ref('')

type Draft = Pick<HelpdeskSettings, 'preset' | 'visibility' | 'default_team_id' | 'default_priority'
  | 'reference_prefix' | 'reopen_days' | 'first_response_hours' | 'resolution_hours'>
const draft = reactive<Draft>({
  preset: 'general',
  visibility: 'team',
  default_team_id: null,
  default_priority: '1',
  reference_prefix: 'HD',
  reopen_days: 7,
  first_response_hours: 8,
  resolution_hours: 72,
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
  })
  revision.value = value.revision
}, { immediate: true })

const dirty = computed(() => {
  const value = settings.data.value
  if (!value) return false
  return (Object.keys(draft) as (keyof Draft)[]).some(key => draft[key] !== value[key])
})
const presetItems = computed(() => (settings.data.value?.options.presets ?? []).map(item => ({ value: item.value, label: t(`helpdesk.settings.presets.${item.value}`) })))
const visibilityItems = computed(() => (settings.data.value?.options.visibility ?? []).map(item => ({ value: item.value, label: t(`helpdesk.settings.visibility.${item.value}`) })))
const priorityItems = computed(() => (settings.data.value?.options.priorities ?? []).map(item => ({ value: item.value, label: t(`helpdesk.priority.${settings.data.value?.options.priority_names[item.value] ?? 'medium'}`) })))
const teamItems = computed(() => [{ value: 0, label: t('helpdesk.form.none') }, ...(reference.data.value?.teams ?? []).map(team => ({ value: team.id, label: team.name }))])
const busy = computed(() => settings.isLoading.value || save.isPending.value)
const canManage = computed(() => can('helpdesk.settings.manage'))

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
        <SharedSettingsSection v-if="settings.data.value" id="policy" :title="t('helpdesk.settings.policy')" :description="t('helpdesk.settings.policyHint')">
          <SharedSettingsCard
            id="helpdesk-policy"
            :title="t('helpdesk.settings.policyTitle')"
            :can-edit="can('helpdesk.settings.manage')"
            :dirty="dirty"
            :saving="save.isPending.value"
            :message="message"
            :save-label="t('helpdesk.settings.save')"
            @save="submit"
            @revert="revert"
          >
            <UFormField :label="t('helpdesk.settings.preset')" name="helpdesk-preset" :help="t('helpdesk.settings.presetHint')">
              <USelect v-model="draft.preset" class="w-full" :items="presetItems" :disabled="busy" data-testid="helpdesk-settings-preset" />
            </UFormField>
            <UFormField :label="t('helpdesk.settings.visibility')" name="helpdesk-visibility" :help="t('helpdesk.settings.visibilityHint')">
              <USelect v-model="draft.visibility" class="w-full" :items="visibilityItems" :disabled="busy" data-testid="helpdesk-settings-visibility" />
            </UFormField>
            <UFormField :label="t('helpdesk.settings.defaultTeam')" name="helpdesk-team">
              <USelect :model-value="draft.default_team_id ?? 0" class="w-full" :items="teamItems" :disabled="busy" data-testid="helpdesk-settings-team" @update:model-value="value => { draft.default_team_id = Number(value) || null }" />
            </UFormField>
            <UFormField :label="t('helpdesk.settings.defaultPriority')" name="helpdesk-priority">
              <USelect v-model="draft.default_priority" class="w-full" :items="priorityItems" :disabled="busy" data-testid="helpdesk-settings-priority" />
            </UFormField>
            <UFormField :label="t('helpdesk.settings.prefix')" name="helpdesk-prefix" :help="t('helpdesk.settings.prefixHint')">
              <UInput v-model="draft.reference_prefix" class="w-full" :maxlength="10" :disabled="busy" data-testid="helpdesk-settings-prefix" />
            </UFormField>
            <UFormField :label="t('helpdesk.settings.reopenDays')" name="helpdesk-reopen" :help="t('helpdesk.settings.reopenHint')">
              <UInputNumber v-model="draft.reopen_days" class="w-full" :min="0" :max="90" :disabled="busy" data-testid="helpdesk-settings-reopen" />
            </UFormField>
            <UFormField :label="t('helpdesk.settings.firstResponse')" name="helpdesk-first-response" :help="t('helpdesk.settings.firstResponseHint')">
              <UInputNumber v-model="draft.first_response_hours" class="w-full" :min="0" :max="720" :disabled="busy" data-testid="helpdesk-settings-first-response" />
            </UFormField>
            <UFormField :label="t('helpdesk.settings.resolution')" name="helpdesk-resolution" :help="t('helpdesk.settings.resolutionHint')">
              <UInputNumber v-model="draft.resolution_hours" class="w-full" :min="0" :max="8760" :disabled="busy" data-testid="helpdesk-settings-resolution" />
            </UFormField>
          </SharedSettingsCard>
        </SharedSettingsSection>
        <template v-if="resources.data.value">
          <SharedSettingsSection id="teams" :title="t('helpdesk.settings.teams.section')" :description="t('helpdesk.settings.teams.sectionHint')">
            <HelpdeskTeamsSection :rows="resources.data.value.teams" :can-edit="canManage" />
          </SharedSettingsSection>
          <SharedSettingsSection id="workflow" :title="t('helpdesk.settings.values.section')" :description="t('helpdesk.settings.values.sectionHint')">
            <HelpdeskStagesSection :rows="resources.data.value.stages" :teams="resources.data.value.teams" :can-edit="canManage" />
            <HelpdeskValueListSection kind="categories" :rows="resources.data.value.categories" :can-edit="canManage" />
            <HelpdeskValueListSection kind="tags" :rows="resources.data.value.tags" :can-edit="canManage" />
            <HelpdeskValueListSection kind="channels" :rows="resources.data.value.channels" :can-edit="canManage" />
            <HelpdeskValueListSection kind="types" :rows="resources.data.value.types" :can-edit="canManage" />
          </SharedSettingsSection>
          <SharedSettingsSection v-if="sla.data.value" id="sla" :title="t('helpdesk.settings.sla.section')" :description="t('helpdesk.settings.sla.sectionHint')">
            <HelpdeskSlaSection
              :rows="sla.data.value.items"
              :stages="resources.data.value.stages"
              :teams="resources.data.value.teams"
              :categories="resources.data.value.categories"
              :tags="resources.data.value.tags"
              :can-edit="canManage"
            />
          </SharedSettingsSection>
        </template>
      </SharedPageState>
    </template>
  </SharedSettingsPage>
</template>
