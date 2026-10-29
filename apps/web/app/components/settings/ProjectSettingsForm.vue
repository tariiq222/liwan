<script setup lang="ts">
import type { ProjectSettings, ProjectSettingsExtension, ProjectSettingsPatch } from '@webvue/contracts'
import StageListEditor from '@/components/pmo/projects/StageListEditor.vue'
import { saveErrorMessage } from '@/utils/formFeedback'
import { useProjectSettings, useUpdateProjectSettings } from '@/composables/useProjectSettings'

const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()

const { data: settings, isLoading, error, refetch } = useProjectSettings()
const { mutate: updateSettings, isPending } = useUpdateProjectSettings()
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
// Controls stay disabled until hydration, while a save is in flight, and while a failed save waits for retry.
const locked = computed(() => !hydrated.value || isPending.value || saveState.value === 'error')
const saveError = ref('')
const pendingPatch = shallowRef<ProjectSettingsPatch | null>(null)
function save(patch: ProjectSettingsPatch) {
  if (!hydrated.value || saveState.value === 'saving') return
  pendingPatch.value = patch
  saveError.value = ''
  saveState.value = 'saving'
  updateSettings(patch, { onSuccess: onSaved, onError: onApiError })
}

function onApiError(e: unknown) {
  saveState.value = 'error'
  saveError.value = saveErrorMessage(e, t('errors.generic'), t('errors.saveUncertain'))
  toast.add({ title: saveError.value, color: 'error' })
}
function onSaved() {
  saveState.value = 'saved'
  pendingPatch.value = null
  toast.add({ title: t('settings.projects.saved'), color: 'success' })
}

// --- who can create projects -------------------------------------------------
// PROJECT_CREATORS has exactly two values; listing them explicitly (rather
// than looping with a dynamic t() key) keeps every translation key a literal
// string, matching how projectStatus.ts maps enum values to label keys.
const CREATOR_OPTIONS: { value: ProjectSettings['project_creators']; labelKey: string }[] = [
  { value: 'managers', labelKey: 'settings.projects.creators.managers' },
  { value: 'employees', labelKey: 'settings.projects.creators.employees' },
]

function onCreatorsChange(v: unknown) {
  const value = v as ProjectSettings['project_creators']
  if (!value || value === settings.value?.project_creators) return
  save({ project_creators: value })
}

function onBool(field: 'require_manager_on_create' | 'require_end_date_on_create' | 'deadline_reminders_enabled' | 'overdue_digest_enabled' | 'require_charter_approval', checked: boolean) {
  if (checked === settings.value?.[field]) return
  save({ [field]: checked })
}

function onApprovalDefault(v: unknown) {
  const value = v as ProjectSettings['default_completion_approval']
  if (!value || value === settings.value?.default_completion_approval) return
  save({ default_completion_approval: value })
}

function onCloseWithOpenTasks(v: unknown) {
  const value = v as ProjectSettings['close_with_open_tasks']
  if (!value || value === settings.value?.close_with_open_tasks) return
  save({ close_with_open_tasks: value })
}

function onRegisterTransitions(v: unknown) {
  const value = v as ProjectSettings['register_status_transitions']
  if (!value || value === settings.value?.register_status_transitions) return
  save({ register_status_transitions: value })
}

function onDaysBefore(days: number) {
  if (!Number.isInteger(days) || days === settings.value?.deadline_reminders_days_before) return
  save({ deadline_reminders_days_before: days })
}

// --- settings other applications add -------------------------------------------
// The server labels each extension and names the company field it writes; a selection or a switch saves under that name.
function onExtension(extension: ProjectSettingsExtension, value: unknown) {
  if (value === undefined || value === extension.value) return
  save({ [extension.name]: value })
}

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

const rows = ref<StageRow[]>([])
watch(
  () => settings.value?.default_stages,
  (stages) => {
    if (stages) rows.value = withIds(stages)
  },
  { immediate: true, flush: 'sync' },
)

function persist(next: StageRow[]) {
  rows.value = withIds(next)
  save({ default_stages: rows.value.map(({ name, fold }) => ({ name, fold })) })
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
  <div class="webvue-form webvue-project-settings-form">
    <SharedUnsavedChanges :dirty="saveState === 'saving' || saveState === 'error'" />
    <p v-if="saveState === 'saving' || saveState === 'saved'" role="status" data-testid="settings-save-feedback" class="text-sm text-muted">{{ t(saveState === 'saving' ? 'app.saving' : 'app.saved') }}</p>
    <UAlert v-else-if="saveState === 'error'" role="alert" color="error" variant="subtle" :title="saveError" data-testid="settings-save-feedback">
      <template #actions><UButton v-if="pendingPatch" type="button" color="neutral" variant="outline" :label="t('app.retry')" @click="save(pendingPatch)" /></template>
    </UAlert>
    <SharedLoadingSkeleton v-if="isLoading" />

    <SharedPageState v-else-if="error" :error="error" @retry="refetch" />

    <template v-else-if="settings">
      <SharedFormSection id="project-creation" panel :title="t('settings.projects.creation.title')" :description="t('settings.projects.creation.hint')" class="webvue-settings-anchor">
        <div class="webvue-setting-rows">
          <UFormField id="project-creators" orientation="horizontal" :label="t('settings.projects.creators.label')" :description="t('settings.projects.creators.hint')">
            <URadioGroup
              :model-value="settings.project_creators"
              :items="CREATOR_OPTIONS.map(option => ({ value: option.value, label: t(option.labelKey) }))"
              :disabled="locked"
              @update:model-value="onCreatorsChange"
            />
          </UFormField>
          <UFormField orientation="horizontal" :label="t('settings.projects.createRequirements.manager')" :description="t('settings.projects.createRequirements.hint')">
            <USwitch id="settings-require-manager" :model-value="settings.require_manager_on_create" :aria-label="t('settings.projects.createRequirements.manager')" :disabled="locked" @update:model-value="v => onBool('require_manager_on_create', v)" />
          </UFormField>
          <UFormField orientation="horizontal" :label="t('settings.projects.createRequirements.endDate')">
            <USwitch id="settings-require-end-date" :model-value="settings.require_end_date_on_create" :aria-label="t('settings.projects.createRequirements.endDate')" :disabled="locked" @update:model-value="v => onBool('require_end_date_on_create', v)" />
          </UFormField>
        </div>
      </SharedFormSection>

      <SharedFormSection id="project-defaults" panel :title="t('settings.projects.defaults.title')" :description="t('settings.projects.defaults.hint')" class="webvue-settings-anchor">
        <div class="webvue-setting-rows">
          <UFormField id="project-stages" :label="t('settings.projects.defaultStages.label')" :description="t('settings.projects.defaultStages.hint')">
            <StageListEditor :stages="rows" :busy="isPending" @add="onAddStage" @rename="onRenameStage" @fold="onFoldStage" @reorder="onReorderStages" @delete="onDeleteStage" />
          </UFormField>
          <UFormField id="project-approval" orientation="horizontal" :label="t('settings.projects.approval.label')" :description="t('settings.projects.approval.hint')">
            <URadioGroup
              :model-value="settings.default_completion_approval"
              :items="[{ value: 'none', label: t('settings.projects.approval.none') }, { value: 'project_manager', label: t('settings.projects.approval.projectManager') }]"
              :disabled="locked"
              @update:model-value="onApprovalDefault"
            />
          </UFormField>
          <UFormField orientation="horizontal" :label="t('settings.projects.charterApproval.label')" :description="t('settings.projects.charterApproval.hint')">
            <USwitch
              id="settings-require-charter-approval" data-testid="settings-require-charter-approval"
              :model-value="settings.require_charter_approval"
              :aria-label="t('settings.projects.charterApproval.label')"
              :disabled="locked"
              @update:model-value="v => onBool('require_charter_approval', v)"
            />
          </UFormField>
          <UFormField id="project-close-open-tasks" orientation="horizontal" :label="t('settings.projects.closeWithOpenTasks.label')" :description="t('settings.projects.closeWithOpenTasks.hint')">
            <URadioGroup
              data-testid="settings-close-with-open-tasks"
              :model-value="settings.close_with_open_tasks"
              :items="[{ value: 'block', label: t('settings.projects.closeWithOpenTasks.block') }, { value: 'allow_with_warning', label: t('settings.projects.closeWithOpenTasks.allowWithWarning') }]"
              :disabled="locked"
              @update:model-value="onCloseWithOpenTasks"
            />
          </UFormField>
          <UFormField id="project-register-transitions" orientation="horizontal" :label="t('settings.projects.registerTransitions.label')" :description="t('settings.projects.registerTransitions.hint')">
            <URadioGroup
              data-testid="settings-register-transitions"
              :model-value="settings.register_status_transitions"
              :items="[{ value: 'sequence', label: t('settings.projects.registerTransitions.sequence') }, { value: 'free', label: t('settings.projects.registerTransitions.free') }]"
              :disabled="locked"
              @update:model-value="onRegisterTransitions"
            />
          </UFormField>
        </div>
      </SharedFormSection>

      <SharedFormSection id="project-reminders" panel :title="t('settings.projects.reminders.label')" :description="t('settings.projects.reminders.hint')" class="webvue-settings-anchor">
        <div class="webvue-setting-rows">
          <UFormField orientation="horizontal" :label="t('settings.projects.reminders.enabled')">
            <USwitch
              id="settings-deadline-reminders" :model-value="settings.deadline_reminders_enabled"
              :aria-label="t('settings.projects.reminders.enabled')"
              :disabled="locked"
              @update:model-value="v => onBool('deadline_reminders_enabled', v)"
            />
          </UFormField>
          <UFormField orientation="horizontal" :label="t('settings.projects.reminders.daysBefore')">
            <UInputNumber
              id="reminder-days"
              :min="0"
              :max="30"
              :model-value="settings.deadline_reminders_days_before"
              :disabled="locked"
              class="w-32"
              @update:model-value="onDaysBefore"
            />
          </UFormField>
          <UFormField orientation="horizontal" :label="t('settings.projects.reminders.digest')">
            <USwitch
              id="settings-overdue-digest" :model-value="settings.overdue_digest_enabled"
              :aria-label="t('settings.projects.reminders.digest')"
              :disabled="locked"
              @update:model-value="v => onBool('overdue_digest_enabled', v)"
            />
          </UFormField>
        </div>
      </SharedFormSection>

      <SharedFormSection v-if="settings.extensions.length" id="project-extensions" panel :title="t('settings.projects.extensions.title')" :description="t('settings.projects.extensions.hint')" class="webvue-settings-anchor">
        <div class="webvue-setting-rows">
          <template v-for="extension in settings.extensions" :key="extension.name">
            <UFormField v-if="extension.kind === 'selection'" :id="`project-extension-${extension.name}`" orientation="horizontal" :label="extension.label" :description="extension.help ?? undefined">
              <URadioGroup
                :model-value="extension.value ?? undefined"
                :items="extension.options"
                :data-testid="`settings-extension-${extension.name}`"
                :disabled="locked"
                @update:model-value="v => onExtension(extension, v)"
              />
            </UFormField>
            <UFormField v-else orientation="horizontal" :label="extension.label" :description="extension.help ?? undefined">
              <USwitch
                :id="`project-extension-${extension.name}`" :data-testid="`settings-extension-${extension.name}`"
                :model-value="extension.value"
                :aria-label="extension.label"
                :disabled="locked"
                @update:model-value="v => onExtension(extension, v)"
              />
            </UFormField>
          </template>
        </div>
      </SharedFormSection>
    </template>
  </div>
</template>
