<script setup lang="ts">
import type { ProjectSettings, ProjectSettingsPatch } from '@liwan/contracts'
import StageListEditor from '@/components/pmo/projects/StageListEditor.vue'
import ChangeCategoriesPanel from '@/components/pmo/projects/settings/ChangeCategoriesPanel.vue'
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
const approval = useCard(({ default_completion_approval, require_charter_approval, close_with_open_tasks, register_status_transitions, change_control_mode, baseline_gate, evm_progress_method, planning_tool_policy, governance_tool_policy, finance_tool_policy }) => (
  { default_completion_approval, require_charter_approval, close_with_open_tasks, register_status_transitions, change_control_mode, baseline_gate, evm_progress_method, planning_tool_policy, governance_tool_policy, finance_tool_policy }
), draft => {
  const governanceRequired = draft.require_charter_approval || draft.change_control_mode === 'required' || draft.baseline_gate === 'required'
  if (governanceRequired && draft.governance_tool_policy !== 'enabled') throw new ApiError(422, 'invalid', t('settings.projects.tools.governanceConflict'), 'governance_tool_policy')
  if (draft.baseline_gate === 'required' && draft.planning_tool_policy !== 'enabled') throw new ApiError(422, 'invalid', t('settings.projects.tools.planningConflict'), 'planning_tool_policy')
})
const toolConflicts = computed(() => {
  const draft = approval.draft.value
  const errors: string[] = []
  if ((draft.require_charter_approval || draft.change_control_mode === 'required' || draft.baseline_gate === 'required') && draft.governance_tool_policy !== 'enabled') errors.push(t('settings.projects.tools.governanceConflict'))
  if (draft.baseline_gate === 'required' && draft.planning_tool_policy !== 'enabled') errors.push(t('settings.projects.tools.planningConflict'))
  return errors
})
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

// Every option list names its translation keys literally (no dynamic t() keys), matching how projectStatus.ts maps
// enum values to label keys. Short two-choice settings are segmented; settings whose options need an explanation are cards.
const creatorItems = computed(() => [
  { value: 'managers', label: t('settings.projects.creators.managers') },
  { value: 'employees', label: t('settings.projects.creators.employees') },
])
const toolPolicyItems = computed(() => [
  { value: 'enabled', label: t('settings.projects.tools.enabled') },
  { value: 'optional', label: t('settings.projects.tools.optional') },
  { value: 'disabled', label: t('settings.projects.tools.disabled') },
])
const completionApprovalItems = computed(() => [
  { value: 'none', label: t('settings.projects.approval.none') },
  { value: 'project_manager', label: t('settings.projects.approval.projectManager') },
])
const closeWithOpenTasksItems = computed(() => [
  { value: 'block', label: t('settings.projects.closeWithOpenTasks.block') },
  { value: 'allow_with_warning', label: t('settings.projects.closeWithOpenTasks.allowWithWarning') },
])
const registerTransitionItems = computed(() => [
  { value: 'sequence', label: t('settings.projects.registerTransitions.sequence') },
  { value: 'free', label: t('settings.projects.registerTransitions.free') },
])
const changeControlOptions = computed(() => [
  { value: 'off', label: t('settings.projects.changeControl.off'), description: t('settings.projects.changeControl.offHint') },
  { value: 'optional', label: t('settings.projects.changeControl.optional'), description: t('settings.projects.changeControl.optionalHint') },
  { value: 'required', label: t('settings.projects.changeControl.required'), description: t('settings.projects.changeControl.requiredHint') },
])
const baselineGateOptions = computed(() => [
  { value: 'off', label: t('settings.projects.baselineGate.off'), description: t('settings.projects.baselineGate.offHint') },
  { value: 'warning', label: t('settings.projects.baselineGate.warning'), description: t('settings.projects.baselineGate.warningHint') },
  { value: 'required', label: t('settings.projects.baselineGate.required'), description: t('settings.projects.baselineGate.requiredHint') },
])
const evmProgressOptions = computed(() => [
  { value: 'binary', label: t('settings.projects.evmProgress.binary'), description: t('settings.projects.evmProgress.binaryHint') },
  { value: 'manual', label: t('settings.projects.evmProgress.manual'), description: t('settings.projects.evmProgress.manualHint') },
])

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
const stageEditor = ref<InstanceType<typeof StageListEditor> | null>(null)

async function persist(next: StageRow[]): Promise<boolean> {
  if (!hydrated.value || isPending.value) return false
  rows.value = withIds(next)
  stageError.value = ''
  failedStages.value = null
  try {
    await updateSettings({ default_stages: rows.value.map(({ name, fold }) => ({ name, fold })) })
    return true
  } catch (e) {
    // The rows stay as typed so the manager can retry without retyping them.
    stageError.value = saveErrorMessage(e, t('errors.generic'), t('errors.saveUncertain'))
    failedStages.value = rows.value
    return false
  }
}

// StageListEditor's ids are typed `number | string` (it also serves the real
// per-project stage editor, whose ids are numeric); this component only ever
// hands it the synthetic string ids from withIds(), so the comparisons below
// only ever match against strings at runtime.
async function onAddStage(name: string) {
  if (await persist([...rows.value, { id: '', name, fold: false }])) stageEditor.value?.clearNewName()
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
    <SharedSettingRow id="project-creators" :label="t('settings.projects.creators.label')" :description="t('settings.projects.creators.hint')">
      <SharedSegmentedControl v-model="creation.draft.value.project_creators" :items="creatorItems" :label="t('settings.projects.creators.label')" :disabled="creationLocked" />
    </SharedSettingRow>
    <SharedSettingRow :label="t('settings.projects.createRequirements.manager')" :description="t('settings.projects.createRequirements.hint')">
      <USwitch id="settings-require-manager" v-model="creation.draft.value.require_manager_on_create" :aria-label="t('settings.projects.createRequirements.manager')" :disabled="creationLocked" />
    </SharedSettingRow>
    <SharedSettingRow :label="t('settings.projects.createRequirements.endDate')">
      <USwitch id="settings-require-end-date" v-model="creation.draft.value.require_end_date_on_create" :aria-label="t('settings.projects.createRequirements.endDate')" :disabled="creationLocked" />
    </SharedSettingRow>
  </SharedSettingsCard>

  <SharedRecordSection id="project-defaults" variant="panel" class="liwan-settings-anchor" :title="t('settings.projects.defaults.title')" :description="t('settings.projects.defaults.hint')">
    <div class="grid gap-4">
      <SharedUnsavedChanges :dirty="isPending || !!failedStages" />
      <UAlert v-if="stageError" role="alert" color="error" variant="subtle" :title="t('app.saveFailed')" :description="stageError" data-testid="stage-save-feedback">
        <template #actions><UButton v-if="failedStages" type="button" color="neutral" variant="outline" :label="t('app.retry')" @click="persist(failedStages)" /></template>
      </UAlert>
      <div class="liwan-setting-rows">
        <UFormField id="project-stages" :label="t('settings.projects.defaultStages.label')" :description="t('settings.projects.defaultStages.hint')">
          <StageListEditor ref="stageEditor" :stages="rows" :busy="isPending || locked" @add="onAddStage" @rename="onRenameStage" @fold="onFoldStage" @reorder="onReorderStages" @delete="onDeleteStage" />
        </UFormField>
      </div>
    </div>
  </SharedRecordSection>

  <SharedSettingsCard id="project-approval" v-bind="approval.state.value" :title="t('settings.projects.approval.label')" :description="t('settings.projects.approval.hint')" :can-edit="canEdit" @save="approval.save" @revert="approval.revert" @reload="approval.reload">
    <SharedFormSection :title="t('settings.projects.tools.title')" :description="t('settings.projects.tools.hint')">
      <SharedSettingRow v-for="key in ['planning', 'governance', 'finance'] as const" :key="key" :label="t(`projects.tools.${key}`)">
        <SharedSegmentedControl v-model="approval.draft.value[`${key}_tool_policy`]" :items="toolPolicyItems" :label="t(`projects.tools.${key}`)" :disabled="approvalLocked" :data-testid="`settings-project-tool-${key}`" />
      </SharedSettingRow>
      <UAlert v-for="conflict in toolConflicts" :key="conflict" color="warning" variant="subtle" :title="conflict" />
    </SharedFormSection>
    <SharedSettingRow id="project-approval-default" :label="t('settings.projects.approval.label')">
      <SharedSegmentedControl v-model="approval.draft.value.default_completion_approval" :items="completionApprovalItems" :label="t('settings.projects.approval.label')" :disabled="approvalLocked" />
    </SharedSettingRow>
    <SharedSettingRow :label="t('settings.projects.charterApproval.label')" :description="t('settings.projects.charterApproval.hint')">
      <USwitch id="settings-require-charter-approval" v-model="approval.draft.value.require_charter_approval" data-testid="settings-require-charter-approval" :aria-label="t('settings.projects.charterApproval.label')" :disabled="approvalLocked" />
    </SharedSettingRow>
    <SharedSettingRow id="project-close-open-tasks" :label="t('settings.projects.closeWithOpenTasks.label')" :description="t('settings.projects.closeWithOpenTasks.hint')">
      <SharedSegmentedControl v-model="approval.draft.value.close_with_open_tasks" data-testid="settings-close-with-open-tasks" :items="closeWithOpenTasksItems" :label="t('settings.projects.closeWithOpenTasks.label')" :disabled="approvalLocked" />
    </SharedSettingRow>
    <SharedSettingRow id="project-register-transitions" :label="t('settings.projects.registerTransitions.label')" :description="t('settings.projects.registerTransitions.hint')">
      <SharedSegmentedControl v-model="approval.draft.value.register_status_transitions" data-testid="settings-register-transitions" :items="registerTransitionItems" :label="t('settings.projects.registerTransitions.label')" :disabled="approvalLocked" />
    </SharedSettingRow>
    <SharedSettingRow id="project-change-control" stacked :label="t('settings.projects.changeControl.label')" :description="t('settings.projects.changeControl.hint')">
      <SharedOptionCards v-model="approval.draft.value.change_control_mode" data-testid="settings-change-control-mode" :options="changeControlOptions" :label="t('settings.projects.changeControl.label')" :disabled="approvalLocked" />
    </SharedSettingRow>
    <SharedSettingRow id="project-baseline-gate" stacked :label="t('settings.projects.baselineGate.label')" :description="t('settings.projects.baselineGate.hint')">
      <SharedOptionCards v-model="approval.draft.value.baseline_gate" data-testid="settings-baseline-gate" :options="baselineGateOptions" :label="t('settings.projects.baselineGate.label')" :disabled="approvalLocked" />
    </SharedSettingRow>
    <SharedSettingRow id="project-evm-progress" stacked :label="t('settings.projects.evmProgress.label')" :description="t('settings.projects.evmProgress.hint')">
      <SharedOptionCards v-model="approval.draft.value.evm_progress_method" data-testid="settings-evm-progress" :options="evmProgressOptions" :label="t('settings.projects.evmProgress.label')" :disabled="approvalLocked" />
    </SharedSettingRow>
  </SharedSettingsCard>

  <ChangeCategoriesPanel :can-edit="canEdit" />

  <SharedSettingsCard id="project-reminders" v-bind="reminders.state.value" :title="t('settings.projects.reminders.label')" :description="t('settings.projects.reminders.hint')" :can-edit="canEdit" @save="reminders.save" @revert="reminders.revert" @reload="reminders.reload">
    <SharedSettingRow :label="t('settings.projects.reminders.enabled')">
      <USwitch id="settings-deadline-reminders" v-model="reminders.draft.value.deadline_reminders_enabled" :aria-label="t('settings.projects.reminders.enabled')" :disabled="remindersLocked" />
    </SharedSettingRow>
    <SharedSettingRow :label="t('settings.projects.reminders.daysBefore')">
      <UFormField :error="daysError || undefined">
        <UInputNumber id="reminder-days" v-model="reminders.draft.value.deadline_reminders_days_before" :min="0" :max="30" :disabled="remindersLocked" class="w-32" />
      </UFormField>
    </SharedSettingRow>
    <SharedSettingRow :label="t('settings.projects.reminders.digest')">
      <USwitch id="settings-overdue-digest" v-model="reminders.draft.value.overdue_digest_enabled" :aria-label="t('settings.projects.reminders.digest')" :disabled="remindersLocked" />
    </SharedSettingRow>
  </SharedSettingsCard>

  <SharedSettingsCard v-if="settings.extensions.length" id="project-extensions" v-bind="extensions.state.value" :title="t('settings.projects.extensions.title')" :description="t('settings.projects.extensions.hint')" :can-edit="canEdit" @save="extensions.save" @revert="extensions.revert" @reload="extensions.reload">
    <template v-for="extension in settings.extensions" :key="extension.name">
      <SharedSettingRow v-if="extension.kind === 'selection'" :id="`project-extension-${extension.name}`" :label="extension.label" :description="extension.help ?? undefined">
        <SharedSegmentedControl :model-value="(extensions.draft.value[extension.name] as string | null) ?? undefined" :items="extension.options" :label="extension.label" :data-testid="`settings-extension-${extension.name}`" :disabled="extensionsLocked" @update:model-value="extensions.draft.value[extension.name] = $event" />
      </SharedSettingRow>
      <SharedSettingRow v-else :label="extension.label" :description="extension.help ?? undefined">
        <USwitch v-model="extensions.draft.value[extension.name]" :id="`project-extension-${extension.name}`" :data-testid="`settings-extension-${extension.name}`" :aria-label="extension.label" :disabled="extensionsLocked" />
      </SharedSettingRow>
    </template>
  </SharedSettingsCard>
</template>
