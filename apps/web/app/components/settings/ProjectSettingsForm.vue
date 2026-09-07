<script setup lang="ts">
import type { ProjectSettings } from '@nasq/contracts'
import { toast } from 'vue-sonner'
import StageListEditor from '@/components/project/StageListEditor.vue'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ApiError } from '@/composables/useApi'
import { useProjectSettings, useUpdateProjectSettings } from '@/composables/useProjectSettings'

const { t } = useI18n()
const hydrated = useHydrated()

const { data: settings, isLoading, error, refetch } = useProjectSettings()
const { mutate: updateSettings, isPending } = useUpdateProjectSettings()

function onApiError(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  // Undo the optimistic row mutation: resync from the last-known-good cached
  // settings rather than leaving the rejected edit displayed.
  rows.value = withIds(settings.value?.default_stages ?? [])
}
function onSaved() {
  toast.success(t('settings.projects.saved'))
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

function onDaysBefore(event: Event) {
  const days = Number((event.target as HTMLInputElement).value)
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
  { immediate: true },
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
  <div class="nasq-form nasq-panel nasq-panel-body">
    <Skeleton v-if="isLoading" class="h-64 w-full" />

    <SharedPageState v-else-if="error" :error="error" @retry="refetch" />

    <template v-else-if="settings">
      <section class="nasq-form-section space-y-4">
        <Label>{{ t('settings.projects.creators.label') }}</Label>
        <RadioGroup :model-value="settings.project_creators" :disabled="!hydrated || isPending" @update:model-value="onCreatorsChange">
          <div v-for="option in CREATOR_OPTIONS" :key="option.value" class="flex items-center gap-2">
            <RadioGroupItem :id="`project-creators-${option.value}`" :value="option.value" />
            <Label :for="`project-creators-${option.value}`" class="font-normal">{{ t(option.labelKey) }}</Label>
          </div>
        </RadioGroup>
      </section>

      <section class="nasq-form-section space-y-4">
        <Label>{{ t('settings.projects.defaultStages.label') }}</Label>
        <p class="text-sm text-muted-foreground">{{ t('settings.projects.defaultStages.hint') }}</p>
        <StageListEditor
          :stages="rows"
          :busy="isPending"
          @add="onAddStage"
          @rename="onRenameStage"
          @fold="onFoldStage"
          @reorder="onReorderStages"
          @delete="onDeleteStage"
        />
      </section>

      <section class="space-y-3">
        <Label>{{ t('settings.projects.createRequirements.label') }}</Label>
        <p class="text-sm text-muted-foreground">{{ t('settings.projects.createRequirements.hint') }}</p>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            :checked="settings.require_manager_on_create"
            :disabled="!hydrated || isPending"
            @change="onBool('require_manager_on_create', ($event.target as HTMLInputElement).checked)"
          >
          <span>{{ t('settings.projects.createRequirements.manager') }}</span>
        </label>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            :checked="settings.require_end_date_on_create"
            :disabled="!hydrated || isPending"
            @change="onBool('require_end_date_on_create', ($event.target as HTMLInputElement).checked)"
          >
          <span>{{ t('settings.projects.createRequirements.endDate') }}</span>
        </label>
      </section>

      <section class="space-y-3">
        <Label>{{ t('settings.projects.approval.label') }}</Label>
        <p class="text-sm text-muted-foreground">{{ t('settings.projects.approval.hint') }}</p>
        <RadioGroup :model-value="settings.default_completion_approval" :disabled="!hydrated || isPending" @update:model-value="onApprovalDefault">
          <div class="flex items-center gap-2">
            <RadioGroupItem id="approval-none" value="none" />
            <Label for="approval-none" class="font-normal">{{ t('settings.projects.approval.none') }}</Label>
          </div>
          <div class="flex items-center gap-2">
            <RadioGroupItem id="approval-manager" value="project_manager" />
            <Label for="approval-manager" class="font-normal">{{ t('settings.projects.approval.projectManager') }}</Label>
          </div>
        </RadioGroup>
      </section>

      <section class="space-y-3">
        <Label>{{ t('settings.projects.reminders.label') }}</Label>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            :checked="settings.deadline_reminders_enabled"
            :disabled="!hydrated || isPending"
            @change="onBool('deadline_reminders_enabled', ($event.target as HTMLInputElement).checked)"
          >
          <span>{{ t('settings.projects.reminders.enabled') }}</span>
        </label>
        <div class="grid gap-2">
          <Label for="reminder-days">{{ t('settings.projects.reminders.daysBefore') }}</Label>
          <Input
            id="reminder-days"
            type="number"
            min="0"
            max="30"
            :model-value="settings.deadline_reminders_days_before"
            :disabled="!hydrated || isPending"
            @change="onDaysBefore"
          />
        </div>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            :checked="settings.overdue_digest_enabled"
            :disabled="!hydrated || isPending"
            @change="onBool('overdue_digest_enabled', ($event.target as HTMLInputElement).checked)"
          >
          <span>{{ t('settings.projects.reminders.digest') }}</span>
        </label>
      </section>
    </template>
  </div>
</template>
