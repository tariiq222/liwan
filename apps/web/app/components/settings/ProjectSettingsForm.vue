<script setup lang="ts">
import type { ProjectSettings } from '@webvue/contracts'
import StageListEditor from '@/components/pmo/projects/StageListEditor.vue'
import { saveErrorMessage } from '@/utils/formFeedback'
import { useProjectSettings, useUpdateProjectSettings } from '@/composables/useProjectSettings'

const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()

const { data: settings, isLoading, error, refetch } = useProjectSettings()
const { mutate: updateSettings, isPending } = useUpdateProjectSettings()
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const saveError = ref('')
const pendingPatch = shallowRef<Partial<ProjectSettings> | null>(null)
function save(patch: Partial<ProjectSettings>) {
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

function onDaysBefore(days: number) {
  if (!Number.isInteger(days) || days === settings.value?.deadline_reminders_days_before) return
  save({ deadline_reminders_days_before: days })
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
        <div class="grid gap-(--webvue-gap-card)">
          <UFormField id="project-creators" :label="t('settings.projects.creators.label')" :description="t('settings.projects.creators.hint')">
            <URadioGroup
              :model-value="settings.project_creators"
              :items="CREATOR_OPTIONS.map(option => ({ value: option.value, label: t(option.labelKey) }))"
              :disabled="!hydrated || isPending || saveState === 'error'"
              @update:model-value="onCreatorsChange"
            />
          </UFormField>
          <UFormField id="project-requirements" :label="t('settings.projects.createRequirements.label')" :description="t('settings.projects.createRequirements.hint')">
            <div class="grid gap-(--webvue-gap-card)">
              <USwitch id="settings-require-manager" :model-value="settings.require_manager_on_create" :label="t('settings.projects.createRequirements.manager')" :disabled="!hydrated || isPending || saveState === 'error'" @update:model-value="v => onBool('require_manager_on_create', v)" />
              <USwitch id="settings-require-end-date" :model-value="settings.require_end_date_on_create" :label="t('settings.projects.createRequirements.endDate')" :disabled="!hydrated || isPending || saveState === 'error'" @update:model-value="v => onBool('require_end_date_on_create', v)" />
            </div>
          </UFormField>
        </div>
      </SharedFormSection>

      <SharedFormSection id="project-defaults" panel :title="t('settings.projects.defaults.title')" :description="t('settings.projects.defaults.hint')" class="webvue-settings-anchor">
        <div class="grid gap-(--webvue-gap-card)">
          <UFormField id="project-stages" :label="t('settings.projects.defaultStages.label')" :description="t('settings.projects.defaultStages.hint')">
            <StageListEditor :stages="rows" :busy="isPending" @add="onAddStage" @rename="onRenameStage" @fold="onFoldStage" @reorder="onReorderStages" @delete="onDeleteStage" />
          </UFormField>
          <UFormField id="project-approval" :label="t('settings.projects.approval.label')" :description="t('settings.projects.approval.hint')">
            <URadioGroup
              :model-value="settings.default_completion_approval"
              :items="[{ value: 'none', label: t('settings.projects.approval.none') }, { value: 'project_manager', label: t('settings.projects.approval.projectManager') }]"
              :disabled="!hydrated || isPending || saveState === 'error'"
              @update:model-value="onApprovalDefault"
            />
          </UFormField>
          <USwitch
            id="settings-require-charter-approval" data-testid="settings-require-charter-approval"
            :model-value="settings.require_charter_approval"
            :label="t('settings.projects.charterApproval.label')"
            :description="t('settings.projects.charterApproval.hint')"
            :disabled="!hydrated || isPending || saveState === 'error'"
            @update:model-value="v => onBool('require_charter_approval', v)"
          />
        </div>
      </SharedFormSection>

      <SharedFormSection id="project-reminders" panel :title="t('settings.projects.reminders.label')" :description="t('settings.projects.reminders.hint')" class="webvue-settings-anchor">
        <div class="grid gap-(--webvue-gap-card)">
          <USwitch
            id="settings-deadline-reminders" :model-value="settings.deadline_reminders_enabled"
            :label="t('settings.projects.reminders.enabled')"
            :disabled="!hydrated || isPending || saveState === 'error'"
            @update:model-value="v => onBool('deadline_reminders_enabled', v)"
          />
          <UFormField :label="t('settings.projects.reminders.daysBefore')">
            <UInputNumber
              id="reminder-days"
              :min="0"
              :max="30"
              :model-value="settings.deadline_reminders_days_before"
              :disabled="!hydrated || isPending || saveState === 'error'"
              class="w-full"
              @update:model-value="onDaysBefore"
            />
          </UFormField>
          <USwitch
            id="settings-overdue-digest" :model-value="settings.overdue_digest_enabled"
            :label="t('settings.projects.reminders.digest')"
            :disabled="!hydrated || isPending || saveState === 'error'"
            @update:model-value="v => onBool('overdue_digest_enabled', v)"
          />
        </div>
      </SharedFormSection>
    </template>
  </div>
</template>
