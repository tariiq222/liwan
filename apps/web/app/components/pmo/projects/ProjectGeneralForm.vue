<script setup lang="ts">
import type { ProjectDetail, ProjectPatch, Visibility } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import TagPicker from '@/components/shared/TagPicker.vue'
import { ApiError } from '@/composables/useApi'
import { usePeople } from '@/composables/usePeople'
import { useUpdateProject } from '@/composables/useProjects'

// Autosaves every field individually via useUpdateProject: no explicit save
// button, each control commits its own patch on blur/Enter/selection.
const props = defineProps<{ project: ProjectDetail }>()

const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutate: updateProject, isPending: saving, isSuccess: saved, isError: saveFailed } = useUpdateProject()

function patch(body: ProjectPatch) {
  updateProject(
    { id: props.project.id, patch: body },
    { onError: (e) => toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' }) },
  )
}

// --- visibility ----------------------------------------------------------------
function onVisibilityChange(v: unknown) {
  const visibility = v as Visibility
  if (!visibility || visibility === props.project.privacy_visibility) return
  patch({ privacy_visibility: visibility })
}

// --- tags --------------------------------------------------------------------
// TagPicker emits both the bare ids (the PATCH body) and the resolved tag
// objects; the resolved list isn't needed here since useUpdateProject's
// onSuccess replaces the whole cached ProjectDetail with the server response.
type TagRef = ProjectDetail['tags'][number]
function onTagsChange({ ids }: { ids: number[]; resolved: TagRef[] }) {
  patch({ tag_ids: ids })
}

const approverOpen = ref(false)
const approverQ = ref('')
const debouncedApproverQ = refDebounced(approverQ, 250)
const { data: approverPeople } = usePeople(debouncedApproverQ)
const pendingMode = ref<ProjectDetail['completion_approval'] | null>(null)
const pendingApproverId = ref<number | null>(null)
const approvalError = ref<string | null>(null)
const approvalBusy = ref(false)
const displayedMode = computed(() => pendingMode.value ?? props.project.completion_approval)

watch(
  () => [props.project.completion_approval, props.project.completion_approver?.id],
  () => {
    pendingMode.value = null
    pendingApproverId.value = null
    approvalError.value = null
  },
)

function saveApproval(mode: ProjectDetail['completion_approval'], approverId: number | null) {
  if (approvalBusy.value) return
  approvalBusy.value = true
  approvalError.value = null
  updateProject(
    {
      id: props.project.id,
      patch: {
        nasq_completion_approval: mode,
        nasq_completion_approver_id: mode === 'specific_user' ? approverId : null,
      },
    },
    {
      onError: (e) => {
        approvalError.value = e instanceof ApiError ? e.message : t('errors.generic')
        toast.add({ title: approvalError.value, color: 'error' })
      },
      onSuccess: () => {
        pendingMode.value = null
        pendingApproverId.value = null
        toast.add({ title: t('projects.settings.saved'), color: 'success' })
      },
      onSettled: () => {
        approvalBusy.value = false
      },
    },
  )
}

function onApprovalChange(v: unknown) {
  const mode = v as ProjectDetail['completion_approval']
  if (!mode || mode === displayedMode.value || approvalBusy.value) return
  if (mode === 'specific_user') {
    pendingMode.value = mode
    pendingApproverId.value = props.project.completion_approver?.id ?? null
    return
  }
  pendingMode.value = null
  saveApproval(mode, null)
}

function selectApprover(userId: number) {
  approverOpen.value = false
  approverQ.value = ''
  pendingApproverId.value = userId
  saveApproval('specific_user', userId)
}

function cancelPendingApproval() {
  pendingMode.value = null
  pendingApproverId.value = null
  approvalError.value = null
}

// USelectMenu can only render a label for an item it has in `:items`; the
// current approver may fall outside the active search results, so it is
// always merged in to keep the selected label correct.
const approverItems = computed(() => {
  const current = props.project.completion_approver
  const list = approverPeople.value ?? []
  if (!current || list.some(person => person.id === current.id)) return list
  return [current, ...list]
})
const approvalLocked = computed(() => approvalBusy.value)
</script>

<template>
  <div class="space-y-5">
    <p role="status" class="text-sm text-muted" data-testid="project-autosave-status">{{ t(saving ? 'projects.clarity.saving' : pendingMode && !approvalError ? 'projects.clarity.chooseApprover' : saveFailed ? 'projects.clarity.saveFailed' : saved ? 'projects.clarity.saved' : 'projects.clarity.autosaveHint') }}</p>
    <UFormField as="section" :description="t('projects.refresh.settings.visibilityHint')">
        <template #label><span id="project-settings-visibility-label">{{ t('projects.settings.visibility') }}</span></template>
        <USelect
          id="project-settings-visibility"
          :model-value="project.privacy_visibility"
          :items="[{ value: 'employees', label: t('projects.settings.visibilityEmployees') }, { value: 'followers', label: t('projects.settings.visibilityFollowers') }]"
          :disabled="!hydrated"
          class="w-full"
          aria-labelledby="project-settings-visibility-label"
          @update:model-value="onVisibilityChange"
        />
    </UFormField>

    <UFormField as="section" orientation="horizontal" :label="t('taskLifecycle.enableDependencies')" :description="t('taskLifecycle.enableDependenciesHint')">
      <USwitch
        :model-value="project.allow_task_dependencies"
        :disabled="!hydrated || !project.can_manage"
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
        :disabled="!hydrated || approvalLocked"
        class="w-full"
        data-testid="project-approval-mode"
        aria-labelledby="project-settings-approval-label"
        @update:model-value="onApprovalChange"
      />
      <p v-if="displayedMode === 'specific_user'" class="text-sm text-muted">{{ t('projects.settings.approverEligibility') }}</p>
      <p v-if="approvalError" role="alert" class="text-sm text-error">{{ approvalError }}</p>
      <div v-if="pendingMode === 'specific_user'" class="flex flex-wrap gap-2">
        <UButton type="button" color="neutral" size="sm" data-testid="project-approval-cancel" :disabled="approvalLocked" :label="t('app.cancel')" @click="cancelPendingApproval" variant="outline" />
      </div>
      <USelectMenu
        v-if="displayedMode === 'specific_user'"
        v-model:search-term="approverQ"
        :model-value="pendingApproverId ?? project.completion_approver?.id ?? undefined"
        :items="approverItems"
        value-key="id"
        label-key="name"
        class="w-full min-w-0"
        :placeholder="t('projects.settings.noApprover')"
        :disabled="!hydrated || approvalLocked"
        data-testid="project-approver"
        aria-labelledby="project-settings-approval-label project-settings-approver-value"
        @update:model-value="value => value != null && selectApprover(value as number)"
      >
        <template #default><span id="project-settings-approver-value" class="truncate">{{ approverItems.find(person => person.id === (pendingApproverId ?? project.completion_approver?.id))?.name || t('projects.settings.noApprover') }}</span></template>
      </USelectMenu>
      </div>
    </UFormField>

    <UFormField as="section">
      <template #label><span id="project-settings-tags-label">{{ t('projects.settings.tags') }}</span></template>
      <div id="project-settings-tags" aria-labelledby="project-settings-tags-label"><TagPicker :model-value="project.tags" :can-create="project.can_manage" labelledby="project-settings-tags-label" @update:model-value="onTagsChange" /></div>
    </UFormField>

    <USeparator />

  </div>
</template>
