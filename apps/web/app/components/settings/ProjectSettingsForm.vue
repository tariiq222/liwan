<script setup lang="ts">
import type { ProjectSettings } from '@nasq/contracts'
import StageListEditor from '@/components/pmo/projects/StageListEditor.vue'
import { ApiError } from '@/composables/useApi'
import { useProjectSettings, useUpdateProjectSettings } from '@/composables/useProjectSettings'

const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()

const { data: settings, isLoading, error, refetch } = useProjectSettings()
const { mutate: updateSettings, isPending } = useUpdateProjectSettings()

function onApiError(e: unknown) {
  toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
  // Undo the optimistic row mutation: resync from the last-known-good cached
  // settings rather than leaving the rejected edit displayed.
  rows.value = withIds(settings.value?.default_stages ?? [])
}
function onSaved() {
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
  updateSettings({ project_creators: value }, { onSuccess: onSaved, onError: onApiError })
}

function onBool(field: 'require_manager_on_create' | 'require_end_date_on_create' | 'deadline_reminders_enabled' | 'overdue_digest_enabled' | 'require_charter_approval', checked: boolean) {
  if (checked === settings.value?.[field]) return
  updateSettings({ [field]: checked }, { onSuccess: onSaved, onError: onApiError })
}

function onApprovalDefault(v: unknown) {
  const value = v as ProjectSettings['default_completion_approval']
  if (!value || value === settings.value?.default_completion_approval) return
  updateSettings({ default_completion_approval: value }, { onSuccess: onSaved, onError: onApiError })
}

function onDaysBefore(days: number) {
  if (!Number.isInteger(days) || days === settings.value?.deadline_reminders_days_before) return
  updateSettings({ deadline_reminders_days_before: days }, { onSuccess: onSaved, onError: onApiError })
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
  updateSettings(
    { default_stages: rows.value.map(({ name, fold }) => ({ name, fold })) },
    { onSuccess: onSaved, onError: onApiError },
  )
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
  <div class="nasq-form nasq-project-settings-form">
    <SharedLoadingSkeleton v-if="isLoading" />

    <SharedPageState v-else-if="error" :error="error" @retry="refetch" />

    <template v-else-if="settings">
      <SharedFormSection id="project-creation" :title="t('settings.projects.creation.title')" :description="t('settings.projects.creation.hint')" class="nasq-settings-anchor space-y-4">
        <UFormField id="project-creators" :label="t('settings.projects.creators.label')" :description="t('settings.projects.creators.hint')">
          <URadioGroup
            :model-value="settings.project_creators"
            :items="CREATOR_OPTIONS.map(option => ({ value: option.value, label: t(option.labelKey) }))"
            :disabled="!hydrated || isPending"
            @update:model-value="onCreatorsChange"
          />
        </UFormField>
        <UFormField id="project-requirements" :label="t('settings.projects.createRequirements.label')" :description="t('settings.projects.createRequirements.hint')">
          <div class="grid gap-3">
            <USwitch :model-value="settings.require_manager_on_create" :label="t('settings.projects.createRequirements.manager')" :disabled="!hydrated || isPending" @update:model-value="v => onBool('require_manager_on_create', v)" />
            <USwitch :model-value="settings.require_end_date_on_create" :label="t('settings.projects.createRequirements.endDate')" :disabled="!hydrated || isPending" @update:model-value="v => onBool('require_end_date_on_create', v)" />
          </div>
        </UFormField>
      </SharedFormSection>

      <SharedFormSection id="project-defaults" :title="t('settings.projects.defaults.title')" :description="t('settings.projects.defaults.hint')" class="nasq-settings-anchor space-y-4">
        <UFormField id="project-stages" :label="t('settings.projects.defaultStages.label')" :description="t('settings.projects.defaultStages.hint')">
          <StageListEditor :stages="rows" :busy="isPending" @add="onAddStage" @rename="onRenameStage" @fold="onFoldStage" @reorder="onReorderStages" @delete="onDeleteStage" />
        </UFormField>
        <UFormField id="project-approval" :label="t('settings.projects.approval.label')" :description="t('settings.projects.approval.hint')">
          <URadioGroup
            :model-value="settings.default_completion_approval"
            :items="[{ value: 'none', label: t('settings.projects.approval.none') }, { value: 'project_manager', label: t('settings.projects.approval.projectManager') }]"
            :disabled="!hydrated || isPending"
            @update:model-value="onApprovalDefault"
          />
        </UFormField>
        <USwitch
          data-testid="settings-require-charter-approval"
          :model-value="settings.require_charter_approval"
          :label="t('settings.projects.charterApproval.label')"
          :description="t('settings.projects.charterApproval.hint')"
          :disabled="!hydrated || isPending"
          @update:model-value="v => onBool('require_charter_approval', v)"
        />
      </SharedFormSection>

      <SharedFormSection id="project-reminders" :title="t('settings.projects.reminders.label')" :description="t('settings.projects.reminders.hint')" class="nasq-settings-anchor space-y-3">
        <USwitch
          :model-value="settings.deadline_reminders_enabled"
          :label="t('settings.projects.reminders.enabled')"
          :disabled="!hydrated || isPending"
          @update:model-value="v => onBool('deadline_reminders_enabled', v)"
        />
        <UFormField :label="t('settings.projects.reminders.daysBefore')">
          <UInputNumber
            id="reminder-days"
            :min="0"
            :max="30"
            :model-value="settings.deadline_reminders_days_before"
            :disabled="!hydrated || isPending"
            class="w-full"
            @update:model-value="onDaysBefore"
          />
        </UFormField>
        <USwitch
          :model-value="settings.overdue_digest_enabled"
          :label="t('settings.projects.reminders.digest')"
          :disabled="!hydrated || isPending"
          @update:model-value="v => onBool('overdue_digest_enabled', v)"
        />
      </SharedFormSection>
    </template>
  </div>
</template>
