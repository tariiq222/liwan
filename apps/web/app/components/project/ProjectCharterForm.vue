<script setup lang="ts">
import type { ProjectCreateDefaults, ProjectDetail } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { isStaleProjectWrite, useCreateProject, useProject, useUpdateProject } from '@/composables/useProjects'
import { useCharterDefaults } from '@/composables/useProjectCharterCatalogs'
import type { CharterDraft, CharterFieldKey, CharterMilestone, NativeDateSnapshot } from '@/utils/projectCharter'
import {
  canOverwriteWithLatest,
  createBodyFromDraft,
  draftFromProject,
  emptyCharterDraft,
  isCharterDraftDirty,
  nativeDateSnapshot,
  patchBodyFromDraft,
  validateCharterDraft,
} from '@/utils/projectCharter'
import ProjectCharterFields from '@/components/project/ProjectCharterFields.vue'
import ProjectCharterDisplay from '@/components/project/ProjectCharterDisplay.vue'

const props = defineProps<{
  mode: 'create' | 'edit'
  project?: ProjectDetail
  readonly?: boolean
  createDefaults?: ProjectCreateDefaults
  defaultManagerName?: string | null
  disabled?: boolean
  milestones?: readonly CharterMilestone[]
  milestonesLoading?: boolean
  milestonesError?: unknown
}>()

const emit = defineEmits<{ created: [id: number]; saved: []; cancel: []; retryMilestones: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: createProject, isPending: creating } = useCreateProject()
const { mutateAsync: updateProject, isPending: updating } = useUpdateProject()
const { data: defaults } = useCharterDefaults(computed(() => props.mode === 'create'))
const projectId = computed(() => props.project?.id ?? null)
const projectQuery = useProject(projectId)

const draft = ref<CharterDraft>(emptyCharterDraft())
const baseline = ref<CharterDraft>(emptyCharterDraft())
const originalDates = ref<NativeDateSnapshot>({ dateStart: null, dateEnd: null })
const writeToken = ref<string | null>(null)
const serverVersion = ref<ProjectDetail | null>(null)
const error = ref<string | null>(null)
const stale = ref(false)
const confirmDiscard = ref(false)
const fieldErrors = ref<Partial<Record<CharterFieldKey, string>>>({})
const loadedProjectId = ref<number | null>(null)
const createDefaultsApplied = ref(false)
const submitted = ref(false)

function snapshotDraft(value: CharterDraft): CharterDraft {
  return {
    ...value,
    objectives: value.objectives.map(row => ({ ...row })),
    deliverables: value.deliverables.map(row => ({ ...row })),
  }
}

const pending = computed(() => !!props.disabled || creating.value || updating.value || projectQuery.isFetching.value)
const readonly = computed(() => !!props.readonly)
const canSubmit = computed(() => hydrated.value && !pending.value && !props.readonly && !!draft.value.name.trim())
const canOverwrite = computed(() => canOverwriteWithLatest(writeToken.value, serverVersion.value))
const dirty = computed(() => !submitted.value && isCharterDraftDirty(draft.value, baseline.value))
const persistedDraft = computed(() => props.project ? draftFromProject(props.project) : draft.value)

watch(
  [() => props.createDefaults, () => props.defaultManagerName],
  ([value, managerName]) => {
    if (props.mode !== 'create' || !value) return
    if (!createDefaultsApplied.value) {
      createDefaultsApplied.value = true
      draft.value.userId = value.default_manager_id
      // Defaults arrive asynchronously and define the initial form state.
      baseline.value = snapshotDraft(draft.value)
    }
    if (draft.value.userId === value.default_manager_id && !draft.value.managerName && managerName) {
      draft.value.managerName = managerName
    }
  },
  { immediate: true, flush: 'sync' },
)

watch(
  () => defaults.value?.currency,
  (currency) => {
    if (props.mode !== 'create' || loadedProjectId.value) return
    if (!currency) return
    draft.value.currencyLabel = currency.symbol ? `${currency.name} (${currency.symbol})` : currency.name
  },
  { immediate: true, flush: 'sync' },
)

watch(
  () => props.project?.id,
  (id) => {
    if (!props.project || props.mode !== 'edit' || !id) return
    if (loadedProjectId.value === id) return
    applyLoadedProject(props.project)
    loadedProjectId.value = id
  },
  { immediate: true, flush: 'sync' },
)

watch(readonly, (value) => {
  if (!value || props.mode !== 'edit' || !props.project) return
  applyLoadedProject(props.project)
})

function applyLoadedProject(project: ProjectDetail) {
  const next = draftFromProject(project)
  draft.value = next
  baseline.value = draftFromProject(project)
  submitted.value = false
  originalDates.value = nativeDateSnapshot(project)
  writeToken.value = project.updated_at
  serverVersion.value = project
}

function errorMessage(code: string): string {
  return t(`projects.charter.errors.${code}`)
}

function applyValidation(): boolean {
  fieldErrors.value = {}
  const errors = validateCharterDraft(draft.value, {
    mode: props.mode,
    originalDates: props.mode === 'edit' ? originalDates.value : undefined,
  })
  for (const item of errors) fieldErrors.value[item.field] = errorMessage(item.code)
  if (props.mode === 'create' && props.createDefaults?.require_manager_on_create && !draft.value.userId) {
    fieldErrors.value.manager = t('projects.create.managerRequired')
  }
  if (props.mode === 'create' && props.createDefaults?.require_end_date_on_create && !draft.value.dateEnd) {
    fieldErrors.value.date_end = t('projects.create.endDateRequired')
  }
  return errors.length === 0 && !fieldErrors.value.manager && !fieldErrors.value.date_end
}

async function submit(token = writeToken.value) {
  error.value = null
  if (!applyValidation()) return
  const preserved = draft.value
  try {
    if (props.mode === 'create') {
      const created = await createProject(createBodyFromDraft(preserved, { includeNullManager: true }))
      submitted.value = true
      emit('created', created.id)
      return
    }
    if (!props.project || !token) return
    const detail = await updateProject({
      id: props.project.id,
      patch: patchBodyFromDraft(preserved, token, originalDates.value),
    })
    applyLoadedProject(detail)
    stale.value = false
    confirmDiscard.value = false
    emit('saved')
  }
  catch (e) {
    draft.value = preserved
    if (isStaleProjectWrite(e)) {
      stale.value = true
      error.value = null
      await loadServerVersion()
      return
    }
    error.value = e instanceof ApiError && e.code === 'create_forbidden'
      ? t('projects.createForbidden')
      : e instanceof ApiError ? e.message : t('errors.generic')
  }
}

async function loadServerVersion() {
  const result = await projectQuery.refetch()
  if (result.data) serverVersion.value = result.data
}

async function overwriteOnLatest() {
  if (!canOverwrite.value || !serverVersion.value) return
  await submit(serverVersion.value.updated_at)
}

function requestDiscard() {
  if (isCharterDraftDirty(draft.value, baseline.value)) {
    confirmDiscard.value = true
    return
  }
  discardToServer()
}

function discardToServer() {
  const detail = serverVersion.value ?? props.project
  if (!detail) return
  applyLoadedProject(detail)
  stale.value = false
  confirmDiscard.value = false
  error.value = null
  fieldErrors.value = {}
}
</script>

<template>
  <div :data-testid="mode === 'create' ? 'project-create-form' : 'project-charter-form'" class="grid gap-6">
    <SharedUnsavedChanges v-if="!readonly || dirty" :dirty="dirty" :guard-route-updates="mode === 'edit'" />
    <ProjectCharterDisplay
      v-if="readonly"
      :draft="persistedDraft"
      :milestones="milestones"
      :milestones-loading="milestonesLoading"
      :milestones-error="milestonesError"
      @retry-milestones="emit('retryMilestones')"
    />
    <form v-else class="grid gap-6" @submit.prevent="submit()">
      <ProjectCharterFields
        v-model="draft"
        :compact="mode === 'create'"
        :project-create="mode === 'create'"
        :disabled="pending"
        :field-errors="fieldErrors"
        :require-manager="mode === 'create' && !!createDefaults?.require_manager_on_create"
        :require-end-date="mode === 'create' && !!createDefaults?.require_end_date_on_create"
      />
    <div v-if="stale" role="alert" data-testid="charter-stale-write" class="rounded-lg border border-warning/30 bg-warning/5 space-y-3 p-3 text-sm">
      <p>{{ t('projects.charter.staleWrite') }}</p>
      <p>{{ t('projects.charter.staleWriteHint') }}</p>
      <div class="flex flex-wrap gap-2">
        <UButton
          type="button"
          data-testid="charter-overwrite-latest"
          :disabled="!hydrated || pending || !canOverwrite"
          :label="t('projects.charter.overwriteLatest')"
          @click="overwriteOnLatest"
        />
        <UButton type="button" color="neutral" data-testid="charter-discard-reload" :disabled="pending" :label="t('projects.charter.discardReload')" @click="requestDiscard" variant="outline" />
      </div>
      <div v-if="confirmDiscard" class="space-y-2 rounded-md border border-error/40 bg-error/5 p-3" data-testid="charter-discard-confirm">
        <p>{{ t('projects.charter.discardReloadConfirm') }}</p>
        <div class="flex flex-wrap gap-2">
          <UButton type="button" color="neutral" :label="t('app.cancel')" @click="confirmDiscard = false" variant="outline" />
          <UButton type="button" color="error" :disabled="!hydrated || pending" :label="t('projects.charter.discardReload')" @click="discardToServer" />
        </div>
      </div>
    </div>
    <p v-else-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <div class="flex flex-wrap gap-2 justify-end">
      <UButton type="button" color="neutral" :disabled="pending" :label="t('app.cancel')" @click="emit('cancel')" variant="outline" />
      <UButton type="submit" data-testid="project-create-submit" :disabled="!canSubmit" :label="mode === 'create' ? t('app.create') : t('app.save')" />
    </div>
    </form>
  </div>
</template>
