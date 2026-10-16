<script setup lang="ts">
import type { ProjectDetail, ProjectPatch, Visibility } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import TagPicker from '@/components/shared/form/TagPicker.vue'
import { saveErrorMessage } from '@/utils/formFeedback'
import { usePeople } from '@/composables/usePeople'
import { useUpdateProject } from '@/composables/useProjects'

// Each operational field autosaves its own patch on selection.
const props = defineProps<{ project: ProjectDetail }>()

const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutate: updateProject } = useUpdateProject()
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const saveError = ref('')
const pendingPatch = shallowRef<ProjectPatch | null>(null)
const controlsLocked = computed(() => !hydrated.value || saveState.value === 'saving' || saveState.value === 'error')

// One request at a time: failed intent stays visible and is retried verbatim.
// A pending approver selection belongs to the user, even if other fields refetch.
function save(body: ProjectPatch) {
  if (!hydrated.value || saveState.value === 'saving') return
  pendingPatch.value = body
  saveError.value = ''
  saveState.value = 'saving'
  updateProject(
    { id: props.project.id, patch: body },
    {
      onError: (error) => {
        saveState.value = 'error'
        saveError.value = saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
        toast.add({ title: saveError.value, color: 'error' })
      },
      onSuccess: () => {
        pendingPatch.value = null
        pendingTags.value = null
        if (body.nasq_completion_approval !== undefined) {
          pendingMode.value = null
          pendingApprover.value = null
        }
        saveState.value = 'saved'
      },
    },
  )
}

function patch(body: ProjectPatch) {
  if (controlsLocked.value) return
  save(body)
}

// --- visibility ----------------------------------------------------------------
function onVisibilityChange(v: unknown) {
  const visibility = v as Visibility
  if (!visibility || visibility === props.project.privacy_visibility) return
  patch({ privacy_visibility: visibility })
}

// --- tags --------------------------------------------------------------------
type TagRef = ProjectDetail['tags'][number]
const pendingTags = shallowRef<TagRef[] | null>(null)
function onTagsChange({ ids, resolved }: { ids: number[]; resolved: TagRef[] }) {
  if (controlsLocked.value) return
  pendingTags.value = resolved
  save({ tag_ids: ids })
}

const approverQ = ref('')
const debouncedApproverQ = refDebounced(approverQ, 250)
const { data: approverPeople } = usePeople(debouncedApproverQ)
const pendingMode = ref<ProjectDetail['completion_approval'] | null>(null)
const pendingApprover = shallowRef<ProjectDetail['completion_approver']>(null)
const displayedMode = computed(() => pendingMode.value ?? props.project.completion_approval)
const displayedApprover = computed(() => pendingMode.value !== null ? pendingApprover.value : props.project.completion_approver)
const choosingApprover = computed(() => pendingMode.value === 'specific_user' && pendingPatch.value === null)
const dirty = computed(() => pendingMode.value !== null || pendingPatch.value !== null)

function saveApproval(mode: ProjectDetail['completion_approval'], approverId: number | null) {
  save({
    nasq_completion_approval: mode,
    nasq_completion_approver_id: mode === 'specific_user' ? approverId : null,
  })
}

function onApprovalChange(v: unknown) {
  const mode = v as ProjectDetail['completion_approval']
  if (!mode || mode === displayedMode.value || controlsLocked.value) return
  pendingMode.value = mode
  pendingApprover.value = props.project.completion_approver
  if (mode !== 'specific_user') saveApproval(mode, null)
}

function selectApprover(userId: number) {
  if (controlsLocked.value) return
  const person = approverItems.value.find(item => item.id === userId)
  if (!person) return
  pendingMode.value = 'specific_user'
  pendingApprover.value = person
  approverQ.value = ''
  saveApproval('specific_user', userId)
}

function cancelPendingApproval() {
  if (controlsLocked.value) return
  pendingMode.value = null
  pendingApprover.value = null
}

// Keep the chosen label when a new search result no longer contains that user.
const approverItems = computed(() => {
  const current = displayedApprover.value
  const list = approverPeople.value ?? []
  if (!current || list.some(person => person.id === current.id)) return list
  return [current, ...list]
})
</script>

<template>
  <div class="space-y-5">
    <SharedUnsavedChanges :dirty="dirty" guard-route-updates />
    <p role="status" class="text-sm text-muted" data-testid="project-autosave-status">{{ t(saveState === 'saving' ? 'projects.clarity.saving' : saveState === 'error' ? 'projects.clarity.saveFailed' : choosingApprover ? 'projects.clarity.chooseApprover' : saveState === 'saved' ? 'projects.clarity.saved' : 'projects.clarity.autosaveHint') }}</p>
    <UAlert v-if="saveState === 'error'" role="alert" color="error" variant="subtle" :title="saveError">
      <template #actions><UButton type="button" color="neutral" variant="outline" data-testid="project-settings-retry" :label="t('app.retry')" @click="pendingPatch && save(pendingPatch)" /></template>
    </UAlert>
    <fieldset :disabled="controlsLocked" class="min-w-0 space-y-5 border-0 p-0">
      <UFormField as="section" :description="t('projects.refresh.settings.visibilityHint')">
          <template #label><span id="project-settings-visibility-label">{{ t('projects.settings.visibility') }}</span></template>
          <USelect
            id="project-settings-visibility"
            :model-value="pendingPatch?.privacy_visibility ?? project.privacy_visibility"
            :items="[{ value: 'employees', label: t('projects.settings.visibilityEmployees') }, { value: 'followers', label: t('projects.settings.visibilityFollowers') }]"
            :disabled="controlsLocked"
            class="w-full"
            aria-labelledby="project-settings-visibility-label"
            @update:model-value="onVisibilityChange"
          />
      </UFormField>

      <UFormField as="section" orientation="horizontal" :label="t('taskLifecycle.enableDependencies')" :description="t('taskLifecycle.enableDependenciesHint')">
        <USwitch
          :model-value="pendingPatch?.allow_task_dependencies ?? project.allow_task_dependencies"
          :disabled="controlsLocked || !project.can_manage"
          :aria-label="t('taskLifecycle.enableDependencies')"
          @update:model-value="value => patch({ allow_task_dependencies: value })"
        />
      </UFormField>

      <UFormField as="section" :description="t('projects.settings.approvalHint')">
        <template #label><span id="project-settings-approval-label">{{ t('projects.settings.approval') }}</span></template>
        <div class="grid gap-2">
        <USelect
          id="project-settings-approval"
          :model-value="displayedMode"
          :items="[{ value: 'none', label: t('projects.settings.approvalNone') }, { value: 'project_manager', label: t('projects.settings.approvalManager') }, { value: 'specific_user', label: t('projects.settings.approvalUser') }]"
          :disabled="controlsLocked"
          class="w-full"
          data-testid="project-approval-mode"
          aria-labelledby="project-settings-approval-label"
          @update:model-value="onApprovalChange"
        />
        <p v-if="displayedMode === 'specific_user'" class="text-sm text-muted">{{ t('projects.settings.approverEligibility') }}</p>
        <div v-if="choosingApprover" class="flex flex-wrap gap-2">
          <UButton type="button" color="neutral" size="sm" data-testid="project-approval-cancel" :disabled="controlsLocked" :label="t('app.cancel')" @click="cancelPendingApproval" variant="outline" />
        </div>
        <USelectMenu
          v-if="displayedMode === 'specific_user'"
          v-model:search-term="approverQ"
          :model-value="displayedApprover?.id ?? undefined"
          :items="approverItems"
          value-key="id"
          label-key="name"
          class="w-full min-w-0"
          :placeholder="t('projects.settings.noApprover')"
          :disabled="controlsLocked"
          data-testid="project-approver"
          aria-labelledby="project-settings-approval-label project-settings-approver-value"
          @update:model-value="value => value != null && selectApprover(value as number)"
        >
          <template #default><span id="project-settings-approver-value" class="truncate">{{ displayedApprover?.name || t('projects.settings.noApprover') }}</span></template>
        </USelectMenu>
        </div>
      </UFormField>

      <UFormField as="section">
        <template #label><span id="project-settings-tags-label">{{ t('projects.settings.tags') }}</span></template>
        <div id="project-settings-tags" aria-labelledby="project-settings-tags-label"><TagPicker :model-value="pendingTags ?? project.tags" :can-create="project.can_manage" labelledby="project-settings-tags-label" @update:model-value="onTagsChange" /></div>
      </UFormField>

      <USeparator />
    </fieldset>
  </div>
</template>
