<script setup lang="ts">
import type { ProjectCreateDefaults, ProjectDetail } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { isStaleProjectWrite, useCharterTransition, useCreateProject, useProject, useUpdateProject } from '@/composables/useProjects'
import { useCharterDefaults } from '@/composables/useProjectCharterCatalogs'
import type { CharterDraft, CharterFieldError, CharterFieldKey, CharterMilestone, NativeDateSnapshot } from '@/utils/projectCharter'
import {
  canOverwriteWithLatest,
  charterAfterSave,
  submitFailureReason,
  sponsorMissingForSubmit,
  charterCreateBody,
  charterErrorsForFields,
  draftFromProject,
  emptyCharterDraft,
  isCharterDraftDirty,
  nativeDateSnapshot,
  charterPatchBody,
  validateCharterDraft,
} from '@/utils/projectCharter'
import {
  adjacentCharterStep,
  charterStepsForType,
  clampCharterStep,
  fieldsForStep,
  parseCharterStepQuery,
  stepForField,
  type CharterWizardStep,
} from '@/utils/charterSteps'
import ProjectCharterFields from '@/components/pmo/projects/ProjectCharterFields.vue'
import ProjectCharterDisplay from '@/components/pmo/projects/ProjectCharterDisplay.vue'

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

const emit = defineEmits<{
  created: [id: number]
  // A create-mode draft save: the project now exists, and the caller moves
  // the walker to its charter page at the same step.
  drafted: [id: number, step: CharterWizardStep, reason?: string]
  draftSaved: []
  // What the save did: kept the charter as is, approved it, or sent it to the sponsor.
  saved: [outcome: 'saved' | 'approved' | 'submitted' | 'reopened']
  cancel: []
  retryMilestones: []
}>()
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const hydrated = useHydrated()
const { mutateAsync: createProject, isPending: creating } = useCreateProject()
const { mutateAsync: updateProject, isPending: updating } = useUpdateProject()
const { mutateAsync: transition, isPending: transitioning } = useCharterTransition()
const { me } = useMe()
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
const stepNotice = ref<string | null>(null)

function snapshotDraft(value: CharterDraft): CharterDraft {
  return {
    ...value,
    objectives: value.objectives.map(row => ({ ...row })),
    deliverables: value.deliverables.map(row => ({ ...row })),
    typeSteps: value.typeSteps ? [...value.typeSteps] : null,
  }
}

// --- steps -----------------------------------------------------------------
// The chosen classification (project type) decides which optional steps the
// charter walks; basics and review always frame them.
const steps = computed(() => charterStepsForType(draft.value.typeSteps))
const step = ref<CharterWizardStep>(parseCharterStepQuery(route.query.step, steps.value))
// Steps the walker has validated past may be revisited from the stepper;
// later ones stay closed until "next" validates the way there.
const reached = ref<number>(steps.value.indexOf(step.value))
const stepIndex = computed(() => steps.value.indexOf(step.value))
const isFirstStep = computed(() => stepIndex.value <= 0)
const isLastStep = computed(() => stepIndex.value === steps.value.length - 1)
const currentFields = computed(() => fieldsForStep(step.value))
const stepperItems = computed(() => steps.value.map((key, index) => ({
  value: key,
  title: t(`projects.charter.steps.${key}`),
  disabled: index > reached.value,
})))

function syncStepQuery(next: CharterWizardStep) {
  if (route.query.step === next) return
  void router.replace({ query: { ...route.query, step: next } })
}

function goTo(next: CharterWizardStep) {
  if (!steps.value.includes(next)) return
  step.value = next
  reached.value = Math.max(reached.value, steps.value.indexOf(next))
  stepNotice.value = null
  syncStepQuery(next)
}

watch(steps, (next) => {
  const clamped = clampCharterStep(step.value, next)
  reached.value = Math.min(reached.value, next.length - 1)
  if (clamped !== step.value) goTo(clamped)
})

watch(() => route.query.step, (value) => {
  const parsed = parseCharterStepQuery(value, steps.value)
  if (parsed === step.value) return
  // Browser back/forward: only steps already reached open from the URL.
  if (steps.value.indexOf(parsed) <= reached.value) step.value = parsed
  else syncStepQuery(step.value)
})

function onStepperSelect(value: string | number | undefined) {
  if (typeof value !== 'string' || !steps.value.includes(value as CharterWizardStep)) return
  goTo(value as CharterWizardStep)
}

// --- state -----------------------------------------------------------------
const pending = computed(() => !!props.disabled || creating.value || updating.value || transitioning.value || projectQuery.isFetching.value)
const readonly = computed(() => !!props.readonly)
const canSubmit = computed(() => hydrated.value && !pending.value && !props.readonly && !!draft.value.name.trim())
const canOverwrite = computed(() => canOverwriteWithLatest(writeToken.value, serverVersion.value))
const dirty = computed(() => !submitted.value && isCharterDraftDirty(draft.value, baseline.value))
const persistedDraft = computed(() => props.project ? draftFromProject(props.project) : draft.value)
// An approved charter stays approved on save; a draft offers "save as draft"
// until the review step finalizes it or sends it to the sponsor.
const baselineApproved = computed(() => props.mode === 'edit' && baseline.value.charterState === 'approved')
// When approval is required and the manager is not the sponsor, finishing sends the charter for approval.
const submitsForApproval = computed(() => !!props.project?.charter.approval_required && draft.value.sponsorId !== me.value?.id)
const finalLabel = computed(() => {
  if (props.mode === 'create') return t('projects.create.createFinal')
  if (baselineApproved.value) return t('app.save')
  return t(submitsForApproval.value ? 'projects.charter.submitForApproval' : 'projects.charter.finalize')
})

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
    // A loaded charter may be reopened at any of its steps from the URL.
    const walk = charterStepsForType(draft.value.typeSteps)
    const start = parseCharterStepQuery(route.query.step, walk)
    step.value = start
    reached.value = Math.max(reached.value, walk.indexOf(start))
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

function collectErrors(): CharterFieldError[] {
  const errors = validateCharterDraft(draft.value, {
    mode: props.mode,
    originalDates: props.mode === 'edit' ? originalDates.value : undefined,
  })
  if (props.mode === 'create' && props.createDefaults?.require_manager_on_create && !draft.value.userId) {
    errors.push({ field: 'manager', code: 'manager_required' })
  }
  if (props.mode === 'create' && props.createDefaults?.require_end_date_on_create && !draft.value.dateEnd) {
    errors.push({ field: 'date_end', code: 'end_date_required' })
  }
  return errors
}

function messageFor(item: CharterFieldError): string {
  if (item.code === 'manager_required') return t('projects.create.managerRequired')
  if (item.code === 'end_date_required') return t('projects.create.endDateRequired')
  return errorMessage(item.code)
}

function showErrors(errors: CharterFieldError[]) {
  fieldErrors.value = {}
  for (const item of errors) fieldErrors.value[item.field] = messageFor(item)
}

// Validates the whole charter; when a field on another step fails, the walker
// jumps there so the error is on screen instead of behind a step it cannot see.
function applyValidation(): boolean {
  const errors = collectErrors()
  showErrors(errors)
  if (!errors.length) return true
  const first = errors.map(item => stepForField(steps.value, item.field)).find((found): found is CharterWizardStep => found !== null)
  if (first && first !== step.value) {
    goTo(first)
    stepNotice.value = t('projects.charter.stepJumped')
  }
  else {
    stepNotice.value = t('projects.charter.stepErrors')
  }
  return false
}

function applyStepValidation(): boolean {
  const errors = charterErrorsForFields(collectErrors(), currentFields.value)
  showErrors(errors)
  stepNotice.value = errors.length ? t('projects.charter.stepErrors') : null
  return errors.length === 0
}

function next() {
  if (!applyStepValidation()) return
  const target = adjacentCharterStep(step.value, steps.value, 1)
  if (target) goTo(target)
}

function previous() {
  const target = adjacentCharterStep(step.value, steps.value, -1)
  if (target) goTo(target)
}

async function saveDraft() {
  await submit(writeToken.value, 'draft')
}

async function finalize() {
  await submit(writeToken.value, 'submit')
}

// What the manager asked for on the last save, replayed by "overwrite on latest".
const lastIntent = ref<'draft' | 'submit'>('submit')

async function submit(token = writeToken.value, intent: 'draft' | 'submit' = 'submit') {
  error.value = null
  if (!applyValidation()) return
  if (intent === 'submit' && props.mode === 'edit' && sponsorMissingForSubmit(!!props.project?.charter.approval_required, baselineApproved.value, draft.value.sponsorId)) {
    goTo('basics')
    error.value = t('projects.charter.sponsorRequired')
    return
  }
  const preserved = draft.value
  lastIntent.value = intent
  try {
    if (props.mode === 'create') {
      const created = await createProject(charterCreateBody(preserved, { includeNullManager: true }))
      submitted.value = true
      if (intent === 'draft') {
        emit('drafted', created.id, step.value)
        return
      }
      try {
        await transition({ id: created.id, action: 'submit', expected: created.updated_at })
      }
      catch (e) {
        // The project exists as a draft: continue on its charter page and say why it was not submitted.
        emit('drafted', created.id, step.value, submitFailureReason(e, t))
        return
      }
      emit('created', created.id)
      return
    }
    if (!props.project || !token) return
    const wasApproved = baselineApproved.value
    const detail = await updateProject({
      id: props.project.id,
      patch: charterPatchBody(preserved, token, originalDates.value),
    })
    applyLoadedProject(detail)
    stale.value = false
    confirmDiscard.value = false
    if (intent === 'draft') {
      emit('draftSaved')
      return
    }
    const afterSave = charterAfterSave(wasApproved, detail.charter.state)
    if (afterSave !== 'submit') {
      emit('saved', afterSave)
      return
    }
    try {
      const result = await transition({ id: detail.id, action: 'submit', expected: detail.updated_at })
      applyLoadedProject(result)
      emit('saved', result.charter.state === 'submitted' ? 'submitted' : 'approved')
    }
    catch (e) {
      // The content save already succeeded; only the submit step failed.
      error.value = `${t('projects.charter.savedNotSubmitted')} ${submitFailureReason(e, t)}`
    }
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
      : e instanceof ApiError && e.code === 'charter_state'
        ? t('projects.charter.lockedWhileSubmitted')
        : e instanceof ApiError ? e.message : t('errors.generic')
  }
}

async function loadServerVersion() {
  const result = await projectQuery.refetch()
  if (result.data) serverVersion.value = result.data
}

async function overwriteOnLatest() {
  if (!canOverwrite.value || !serverVersion.value) return
  await submit(serverVersion.value.updated_at, lastIntent.value)
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
    <SharedUnsavedChanges v-if="!readonly || dirty" :dirty="dirty" :guard-route-updates="mode === 'edit'" :ignore-query-keys="['step']" />
    <ProjectCharterDisplay
      v-if="readonly"
      :draft="persistedDraft"
      :milestones="milestones"
      :milestones-loading="milestonesLoading"
      :milestones-error="milestonesError"
      @retry-milestones="emit('retryMilestones')"
    >
      <template #state><slot name="state" /></template>
      <template #actions><slot name="actions" /></template>
    </ProjectCharterDisplay>
    <form v-else class="grid gap-6" data-testid="project-charter-wizard" @submit.prevent="isLastStep ? finalize() : next()">
      <div class="grid gap-3">
        <UStepper
          :model-value="step"
          :items="stepperItems"
          :linear="false"
          :disabled="pending || !hydrated"
          size="sm"
          data-testid="charter-stepper"
          :ui="{ title: 'hidden md:block', description: 'hidden md:block' }"
          @update:model-value="onStepperSelect"
        />
        <p class="text-sm text-muted" data-testid="charter-step-position" aria-live="polite">
          {{ t('projects.charter.stepOf', { step: stepIndex + 1, total: steps.length, title: t(`projects.charter.steps.${step}`) }) }}
        </p>
        <p v-if="stepIndex === 0" class="text-sm text-muted">{{ t('projects.charter.stepsHint') }}</p>
      </div>

      <p v-if="stepNotice" role="alert" data-testid="charter-step-notice" class="text-sm text-error">{{ stepNotice }}</p>

      <div v-if="isLastStep" class="grid gap-4" data-testid="charter-review-step">
        <p class="text-sm text-muted">{{ t('projects.charter.reviewHint') }}</p>
        <ProjectCharterDisplay :draft="draft" :milestones="milestones ?? []" />
      </div>
      <ProjectCharterFields
        v-else
        :key="step"
        v-model="draft"
        :fields="currentFields"
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
        <SharedInlineConfirm
          v-if="confirmDiscard"
          data-testid="charter-discard-confirm"
          :title="t('projects.charter.discardReloadConfirm')"
          :confirm-label="t('projects.charter.discardReload')"
          :disabled="pending"
          @cancel="confirmDiscard = false"
          @confirm="discardToServer"
        />
      </div>
      <p v-else-if="error" role="alert" class="text-sm text-error">{{ error }}</p>

      <p v-if="project?.charter.approval_required && baselineApproved" class="text-sm text-muted" data-testid="charter-save-reopens-hint">{{ t('projects.charter.saveReopensHint') }}</p>
      <SharedFormActions class="flex flex-wrap items-center gap-2" data-testid="charter-wizard-actions">
        <UButton type="button" color="neutral" :disabled="pending" :label="t('app.cancel')" @click="emit('cancel')" variant="outline" />
        <div class="ms-auto flex flex-wrap gap-2">
          <UButton
            v-if="!isFirstStep"
            type="button"
            color="neutral"
            variant="outline"
            data-testid="charter-step-previous"
            :disabled="!hydrated || pending"
            :label="t('projects.charter.previous')"
            @click="previous"
          />
          <UButton
            v-if="!baselineApproved"
            type="button"
            color="neutral"
            variant="outline"
            data-testid="charter-save-draft"
            :disabled="!canSubmit"
            :label="t('projects.charter.saveDraft')"
            @click="saveDraft"
          />
          <UButton
            v-else-if="!isLastStep"
            type="button"
            color="neutral"
            variant="outline"
            data-testid="charter-save-final"
            :disabled="!canSubmit"
            :label="t('app.save')"
            @click="finalize"
          />
          <UButton
            v-if="!isLastStep"
            type="submit"
            data-testid="charter-step-next"
            :disabled="!hydrated || pending"
            :label="t('projects.charter.next')"
          />
          <UButton
            v-else
            type="submit"
            data-testid="project-create-submit"
            :disabled="!canSubmit"
            :label="finalLabel"
          />
        </div>
      </SharedFormActions>
    </form>
  </div>
</template>
