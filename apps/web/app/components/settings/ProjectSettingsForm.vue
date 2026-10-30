<script setup lang="ts">
import type { ProjectSettings, ProjectSettingsPatch } from '@liwan/contracts'
import StageListEditor from '@/components/pmo/projects/StageListEditor.vue'
import { ApiError } from '@/composables/useApi'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { saveErrorMessage } from '@/utils/formFeedback'
import { useProjectSettings, useUpdateProjectSettings } from '@/composables/useProjectSettings'

// The project settings: each card keeps its own draft and saves its own fields with one button. The default stages are
// a list that saves row by row, so they sit in a panel of their own.
const props = defineProps<{ settings: ProjectSettings; canEdit: boolean }>()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const { refetch } = useProjectSettings()
const { mutateAsync: updateSettings, isPending } = useUpdateProjectSettings()
const locked = computed(() => !hydrated.value || !props.canEdit)

type Fields = Record<string, unknown>
/** One card: its fields are copied out of the settings, and a save sends only the ones that changed. */
function useCard<Draft extends Fields>(read: (settings: ProjectSettings) => Draft, validate?: (draft: Draft) => void) {
  return useSettingsForm<ProjectSettings, Draft>({
    source: () => props.settings,
    read,
    save: async (draft, latest) => {
      validate?.(draft)
      const before: Fields = read(latest)
      const changed = Object.fromEntries(Object.entries(draft).filter(([name, value]) => value !== before[name]))
      const saved = await updateSettings(changed as ProjectSettingsPatch)
      toast.add({ title: t('settings.projects.saved'), color: 'success' })
      return saved
    },
    reload: async () => {
      const result = await refetch()
      if (result.isError) throw result.error
      return result.data ?? props.settings
    },
  })
}

const creation = useCard(({ project_creators, require_manager_on_create, require_end_date_on_create }) => (
  { project_creators, require_manager_on_create, require_end_date_on_create }
))
const approval = useCard(({ default_completion_approval, require_charter_approval, close_with_open_tasks, register_status_transitions }) => (
  { default_completion_approval, require_charter_approval, close_with_open_tasks, register_status_transitions }
))
const daysError = ref('')
const reminders = useCard(({ deadline_reminders_enabled, deadline_reminders_days_before, overdue_digest_enabled }) => (
  { deadline_reminders_enabled, deadline_reminders_days_before, overdue_digest_enabled }
), ({ deadline_reminders_days_before: days }) => {
  daysError.value = Number.isInteger(days) && days >= 0 && days <= 30 ? '' : t('settings.projects.reminders.daysInvalid')
  if (daysError.value) throw new ApiError(422, 'invalid', daysError.value, 'deadline_reminders_days_before')
})
watch(() => reminders.draft.value.deadline_reminders_days_before, () => { daysError.value = '' })
// The settings other applications add: the server labels each one and names the company field it writes.
const extensions = useCard(({ extensions: added }) => Object.fromEntries(added.map(extension => [extension.name, extension.value])))
const lockedWhile = (card: { state: { value: { saving: boolean; reloading: boolean } } }) => computed(() => locked.value || card.state.value.saving || card.state.value.reloading)
const creationLocked = lockedWhile(creation)
const approvalLocked = lockedWhile(approval)
const remindersLocked = lockedWhile(reminders)
const extensionsLocked = lockedWhile(extensions)

// PROJECT_CREATORS has exactly two values; listing them explicitly (rather
// than looping with a dynamic t() key) keeps every translation key a literal
// string, matching how projectStatus.ts maps enum values to label keys.
const CREATOR_OPTIONS: { value: ProjectSettings['project_creators']; labelKey: string }[] = [
  { value: 'managers', labelKey: 'settings.projects.creators.managers' },
  { value: 'employees', labelKey: 'settings.projects.creators.employees' },
]

// --- default stages ------------------------------------------------------------
// A settings default_stage is just {name, fold} — there's no id and no
// per-stage endpoint (unlike a real project's stages). StageListEditor still
// needs a stable id per row for drag/rename/delete, so this component hands
// it synthetic ids derived from row position and strips them back out before
// every PATCH: each editor event rebuilds the full list from the current
// rows and sends the whole default_stages array.
interface StageRow { id: string; name: string; fold: boolean }
function withIds(stages: { name: string; fold: boolean }[]): StageRow[] {
  return stages.map((s, i) => ({ id: `s-${i}`, name: s.name, fold: s.fold }))
}

const rows = ref<StageRow[]>(withIds(props.settings.default_stages))
watch(() => props.settings.default_stages, (stages) => { rows.value = withIds(stages) }, { flush: 'sync' })
const stageError = ref('')
const failedStages = shallowRef<StageRow[] | null>(null)

async function persist(next: StageRow[]) {
  if (!hydrated.value || isPending.value) return
  rows.value = withIds(next)
  stageError.value = ''
  failedStages.value = null
  try {
    await updateSettings({ default_stages: rows.value.map(({ name, fold }) => ({ name, fold })) })
  } catch (e) {
    // The rows stay as typed so the manager can retry without retyping them.
    stageError.value = saveErrorMessage(e, t('errors.generic'), t('errors.saveUncertain'))
    failedStages.value = rows.value
  }
}

// StageListEditor's ids are typed `number | string` (it also serves the real
// per-project stage editor, whose ids are numeric); this component only ever
// hands it the synthetic string ids from withIds(), so the comparisons below
// only ever match against strings at runtime.
function onAddStage(name: string) {
  persist([...rows.value, { id: '', name, fold: false }])
}
function onRenameStage(id: number | string, name: string) {
  persist(rows.value.map((r) => (r.id === id ? { ...r, name } : r)))
}
function onFoldStage(id: number | string, fold: boolean) {
  persist(rows.value.map((r) => (r.id === id ? { ...r, fold } : r)))
}
function onReorderStages(ids: (number | string)[]) {
  const byId = new Map(rows.value.map((r) => [r.id, r]))
  persist(ids.map((id) => byId.get(String(id))).filter((r): r is StageRow => !!r))
}
function onDeleteStage(id: number | string) {
  persist(rows.value.filter((r) => r.id !== id))
}
</script>

<template>
  <SharedSettingsCard id="project-creation" v-bind="creation.state.value" :title="t('settings.projects.creation.title')" :description="t('settings.projects.creation.hint')" :can-edit="canEdit" @save="creation.save" @revert="creation.revert" @reload="creation.reload">
    <UFormField id="project-creators" orientation="horizontal" :label="t('settings.projects.creators.label')" :description="t('settings.projects.creators.hint')">
      <URadioGroup v-model="creation.draft.value.project_creators" :items="CREATOR_OPTIONS.map(option => ({ value: option.value, label: t(option.labelKey) }))" :disabled="creationLocked" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('settings.projects.createRequirements.manager')" :description="t('settings.projects.createRequirements.hint')">
      <USwitch id="settings-require-manager" v-model="creation.draft.value.require_manager_on_create" :aria-label="t('settings.projects.createRequirements.manager')" :disabled="creationLocked" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('settings.projects.createRequirements.endDate')">
      <USwitch id="settings-require-end-date" v-model="creation.draft.value.require_end_date_on_create" :aria-label="t('settings.projects.createRequirements.endDate')" :disabled="creationLocked" />
    </UFormField>
  </SharedSettingsCard>

  <SharedRecordSection id="project-defaults" variant="panel" class="liwan-settings-anchor" :title="t('settings.projects.defaults.title')" :description="t('settings.projects.defaults.hint')">
    <div class="grid gap-4">
      <SharedUnsavedChanges :dirty="isPending || !!failedStages" />
      <UAlert v-if="stageError" role="alert" color="error" variant="subtle" :title="t('app.saveFailed')" :description="stageError" data-testid="stage-save-feedback">
        <template #actions><UButton v-if="failedStages" type="button" color="neutral" variant="outline" :label="t('app.retry')" @click="persist(failedStages)" /></template>
      </UAlert>
      <div class="liwan-setting-rows">
        <UFormField id="project-stages" :label="t('settings.projects.defaultStages.label')" :description="t('settings.projects.defaultStages.hint')">
          <StageListEditor :stages="rows" :busy="isPending || locked" @add="onAddStage" @rename="onRenameStage" @fold="onFoldStage" @reorder="onReorderStages" @delete="onDeleteStage" />
        </UFormField>
      </div>
    </div>
  </SharedRecordSection>

  <SharedSettingsCard id="project-approval" v-bind="approval.state.value" :title="t('settings.projects.approval.label')" :description="t('settings.projects.approval.hint')" :can-edit="canEdit" @save="approval.save" @revert="approval.revert" @reload="approval.reload">
    <UFormField id="project-approval-default" orientation="horizontal" :label="t('settings.projects.approval.label')">
      <URadioGroup
        v-model="approval.draft.value.default_completion_approval"
        :items="[{ value: 'none', label: t('settings.projects.approval.none') }, { value: 'project_manager', label: t('settings.projects.approval.projectManager') }]"
        :disabled="approvalLocked"
      />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('settings.projects.charterApproval.label')" :description="t('settings.projects.charterApproval.hint')">
      <USwitch id="settings-require-charter-approval" v-model="approval.draft.value.require_charter_approval" data-testid="settings-require-charter-approval" :aria-label="t('settings.projects.charterApproval.label')" :disabled="approvalLocked" />
    </UFormField>
    <UFormField id="project-close-open-tasks" orientation="horizontal" :label="t('settings.projects.closeWithOpenTasks.label')" :description="t('settings.projects.closeWithOpenTasks.hint')">
      <URadioGroup
        v-model="approval.draft.value.close_with_open_tasks"
        data-testid="settings-close-with-open-tasks"
        :items="[{ value: 'block', label: t('settings.projects.closeWithOpenTasks.block') }, { value: 'allow_with_warning', label: t('settings.projects.closeWithOpenTasks.allowWithWarning') }]"
        :disabled="approvalLocked"
      />
    </UFormField>
    <UFormField id="project-register-transitions" orientation="horizontal" :label="t('settings.projects.registerTransitions.label')" :description="t('settings.projects.registerTransitions.hint')">
      <URadioGroup
        v-model="approval.draft.value.register_status_transitions"
        data-testid="settings-register-transitions"
        :items="[{ value: 'sequence', label: t('settings.projects.registerTransitions.sequence') }, { value: 'free', label: t('settings.projects.registerTransitions.free') }]"
        :disabled="approvalLocked"
      />
    </UFormField>
  </SharedSettingsCard>

  <SharedSettingsCard id="project-reminders" v-bind="reminders.state.value" :title="t('settings.projects.reminders.label')" :description="t('settings.projects.reminders.hint')" :can-edit="canEdit" @save="reminders.save" @revert="reminders.revert" @reload="reminders.reload">
    <UFormField orientation="horizontal" :label="t('settings.projects.reminders.enabled')">
      <USwitch id="settings-deadline-reminders" v-model="reminders.draft.value.deadline_reminders_enabled" :aria-label="t('settings.projects.reminders.enabled')" :disabled="remindersLocked" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('settings.projects.reminders.daysBefore')" :error="daysError || undefined">
      <UInputNumber id="reminder-days" v-model="reminders.draft.value.deadline_reminders_days_before" :min="0" :max="30" :disabled="remindersLocked" class="w-32" />
    </UFormField>
    <UFormField orientation="horizontal" :label="t('settings.projects.reminders.digest')">
      <USwitch id="settings-overdue-digest" v-model="reminders.draft.value.overdue_digest_enabled" :aria-label="t('settings.projects.reminders.digest')" :disabled="remindersLocked" />
    </UFormField>
  </SharedSettingsCard>

  <SharedSettingsCard v-if="settings.extensions.length" id="project-extensions" v-bind="extensions.state.value" :title="t('settings.projects.extensions.title')" :description="t('settings.projects.extensions.hint')" :can-edit="canEdit" @save="extensions.save" @revert="extensions.revert" @reload="extensions.reload">
    <template v-for="extension in settings.extensions" :key="extension.name">
      <UFormField v-if="extension.kind === 'selection'" :id="`project-extension-${extension.name}`" orientation="horizontal" :label="extension.label" :description="extension.help ?? undefined">
        <URadioGroup :model-value="(extensions.draft.value[extension.name] as string | null) ?? undefined" :items="extension.options" :data-testid="`settings-extension-${extension.name}`" :disabled="extensionsLocked" @update:model-value="extensions.draft.value[extension.name] = $event" />
      </UFormField>
      <UFormField v-else orientation="horizontal" :label="extension.label" :description="extension.help ?? undefined">
        <USwitch v-model="extensions.draft.value[extension.name]" :id="`project-extension-${extension.name}`" :data-testid="`settings-extension-${extension.name}`" :aria-label="extension.label" :disabled="extensionsLocked" />
      </UFormField>
    </template>
  </SharedSettingsCard>
</template>
