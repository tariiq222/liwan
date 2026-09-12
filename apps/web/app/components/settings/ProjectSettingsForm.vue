<script setup lang="ts">
import type { ProjectSettings } from '@nasq/contracts'
import StageListEditor from '@/components/project/StageListEditor.vue'
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

function onBool(field: 'require_manager_on_create' | 'require_end_date_on_create' | 'deadline_reminders_enabled' | 'overdue_digest_enabled', checked: boolean) {
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
    <USkeleton v-if="isLoading" class="h-64 w-full" />

    <SharedPageState v-else-if="error" :error="error" @retry="refetch" />

    <template v-else-if="settings">
      <SharedFormSection id="project-creation" :title="t('settings.projects.creation.title')" :description="t('settings.projects.creation.hint')" class="nasq-settings-anchor space-y-4">
        <div id="project-creators" class="space-y-2">
          <span class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('settings.projects.creators.label') }}</span>
          <p class="text-sm text-muted">{{ t('settings.projects.creators.hint') }}</p>
          <URadioGroup
            :model-value="settings.project_creators"
            :items="CREATOR_OPTIONS.map(option => ({ value: option.value, label: t(option.labelKey) }))"
            :disabled="!hydrated || isPending"
            @update:model-value="onCreatorsChange"
          />
        </div>
        <div id="project-requirements" class="space-y-3">
          <span class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('settings.projects.createRequirements.label') }}</span>
          <p class="text-sm text-muted">{{ t('settings.projects.createRequirements.hint') }}</p>
          <label class="flex items-center gap-2">
            <USwitch :model-value="settings.require_manager_on_create" :disabled="!hydrated || isPending" @update:model-value="v => onBool('require_manager_on_create', v)" />
            <span>{{ t('settings.projects.createRequirements.manager') }}</span>
          </label>
          <label class="flex items-center gap-2">
            <USwitch :model-value="settings.require_end_date_on_create" :disabled="!hydrated || isPending" @update:model-value="v => onBool('require_end_date_on_create', v)" />
            <span>{{ t('settings.projects.createRequirements.endDate') }}</span>
          </label>
        </div>
      </SharedFormSection>

      <SharedFormSection id="project-defaults" :title="t('settings.projects.defaults.title')" :description="t('settings.projects.defaults.hint')" class="nasq-settings-anchor space-y-4">
        <div id="project-stages" class="space-y-4">
          <span class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('settings.projects.defaultStages.label') }}</span>
          <p class="text-sm text-muted">{{ t('settings.projects.defaultStages.hint') }}</p>
          <StageListEditor :stages="rows" :busy="isPending" @add="onAddStage" @rename="onRenameStage" @fold="onFoldStage" @reorder="onReorderStages" @delete="onDeleteStage" />
        </div>
        <div id="project-approval" class="space-y-3">
          <span class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('settings.projects.approval.label') }}</span>
          <p class="text-sm text-muted">{{ t('settings.projects.approval.hint') }}</p>
          <URadioGroup
            :model-value="settings.default_completion_approval"
            :items="[{ value: 'none', label: t('settings.projects.approval.none') }, { value: 'project_manager', label: t('settings.projects.approval.projectManager') }]"
            :disabled="!hydrated || isPending"
            @update:model-value="onApprovalDefault"
          />
        </div>
      </SharedFormSection>

      <SharedFormSection id="project-reminders" :title="t('settings.projects.reminders.label')" :description="t('settings.projects.reminders.hint')" class="nasq-settings-anchor space-y-3">
        <label class="flex items-center gap-2">
          <USwitch
            :model-value="settings.deadline_reminders_enabled"
            :disabled="!hydrated || isPending"
            @update:model-value="v => onBool('deadline_reminders_enabled', v)"
          />
          <span>{{ t('settings.projects.reminders.enabled') }}</span>
        </label>
        <div class="grid gap-2">
          <label for="reminder-days" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('settings.projects.reminders.daysBefore') }}</label>
          <UInputNumber
            id="reminder-days"
            :min="0"
            :max="30"
            :model-value="settings.deadline_reminders_days_before"
            :disabled="!hydrated || isPending"
            class="w-full"
            @update:model-value="onDaysBefore"
          />
        </div>
        <label class="flex items-center gap-2">
          <USwitch
            :model-value="settings.overdue_digest_enabled"
            :disabled="!hydrated || isPending"
            @update:model-value="v => onBool('overdue_digest_enabled', v)"
          />
          <span>{{ t('settings.projects.reminders.digest') }}</span>
        </label>
      </SharedFormSection>
    </template>
  </div>
</template>
