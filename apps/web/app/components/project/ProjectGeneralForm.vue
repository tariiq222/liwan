<script setup lang="ts">
import type { ProjectDetail, ProjectPatch, Visibility } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import { Check } from '@lucide/vue'
import { toast } from 'vue-sonner'
import TagPicker from '@/components/task/TagPicker.vue'
import { ApiError } from '@/composables/useApi'
import { usePeople } from '@/composables/usePeople'
import { useUpdateProject } from '@/composables/useProjects'

// Autosaves every field individually via useUpdateProject: no explicit save
// button, each control commits its own patch on blur/Enter/selection.
const props = defineProps<{ project: ProjectDetail }>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutate: updateProject } = useUpdateProject()

function patch(body: ProjectPatch) {
  updateProject(
    { id: props.project.id, patch: body },
    { onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')) },
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
        toast.error(approvalError.value)
      },
      onSuccess: () => {
        pendingMode.value = null
        pendingApproverId.value = null
        toast.success(t('projects.settings.saved'))
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

const displayedApproverName = computed(() => {
  if (pendingApproverId.value) {
    return approverPeople.value?.find(person => person.id === pendingApproverId.value)?.name
      ?? props.project.completion_approver?.name
      ?? t('projects.settings.noApprover')
  }
  return props.project.completion_approver?.name ?? t('projects.settings.noApprover')
})
const approvalLocked = computed(() => approvalBusy.value)
</script>

<template>
  <div class="space-y-5">
    <section class="space-y-2">
        <Label id="project-settings-visibility-label" for="project-settings-visibility">{{ t('projects.settings.visibility') }}</Label>
        <p class="text-sm text-muted-foreground">{{ t('projects.refresh.settings.visibilityHint') }}</p>
        <Select :model-value="project.privacy_visibility" :disabled="!hydrated" @update:model-value="onVisibilityChange">
          <SelectTrigger id="project-settings-visibility" class="w-full" aria-labelledby="project-settings-visibility-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="employees">{{ t('projects.settings.visibilityEmployees') }}</SelectItem>
            <SelectItem value="followers">{{ t('projects.settings.visibilityFollowers') }}</SelectItem>
          </SelectContent>
        </Select>
    </section>

    <section class="flex items-center justify-between gap-3">
      <div>
        <Label>{{ t('taskLifecycle.enableDependencies') }}</Label>
        <p class="text-sm text-muted-foreground">{{ t('taskLifecycle.enableDependenciesHint') }}</p>
      </div>
      <input
        type="checkbox"
        :checked="project.allow_task_dependencies"
        :disabled="!hydrated || !project.can_manage"
        :aria-label="t('taskLifecycle.enableDependencies')"
        @change="patch({ allow_task_dependencies: ($event.target as HTMLInputElement).checked })"
      />
    </section>

    <section class="space-y-2">
      <Label id="project-settings-approval-label" for="project-settings-approval">{{ t('projects.settings.approval') }}</Label>
      <p class="text-sm text-muted-foreground">{{ t('projects.settings.approvalHint') }}</p>
      <Select :model-value="displayedMode" :disabled="!hydrated || approvalLocked" @update:model-value="onApprovalChange">
        <SelectTrigger id="project-settings-approval" class="w-full" data-testid="project-approval-mode" aria-labelledby="project-settings-approval-label">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{{ t('projects.settings.approvalNone') }}</SelectItem>
          <SelectItem value="project_manager">{{ t('projects.settings.approvalManager') }}</SelectItem>
          <SelectItem value="specific_user">{{ t('projects.settings.approvalUser') }}</SelectItem>
        </SelectContent>
      </Select>
      <p v-if="displayedMode === 'specific_user'" class="text-sm text-muted-foreground">{{ t('projects.settings.approverEligibility') }}</p>
      <p v-if="approvalError" role="alert" class="text-sm text-destructive">{{ approvalError }}</p>
      <div v-if="pendingMode === 'specific_user'" class="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" data-testid="project-approval-cancel" :disabled="approvalLocked" @click="cancelPendingApproval">{{ t('app.cancel') }}</Button>
      </div>
      <Popover v-if="displayedMode === 'specific_user'" v-model:open="approverOpen">
        <PopoverTrigger as-child>
          <Button variant="outline" class="w-full min-w-0 justify-start" type="button" data-testid="project-approver" :disabled="!hydrated || approvalLocked" aria-labelledby="project-settings-approval-label project-settings-approver-value">
            <span id="project-settings-approver-value" class="min-w-0 truncate" :title="displayedApproverName">{{ displayedApproverName }}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-64 p-0" align="start">
          <div class="border-b p-2">
            <Input v-model="approverQ" :placeholder="t('app.search')" class="h-8" />
          </div>
          <Command>
            <CommandList>
              <CommandEmpty>{{ t('app.noResults') }}</CommandEmpty>
              <CommandGroup>
                <CommandItem v-for="p in approverPeople ?? []" :key="p.id" :value="String(p.id)" @select="selectApprover(p.id)">
                  <span class="flex-1">{{ p.name }}</span>
                  <Check v-if="project.completion_approver?.id === p.id" class="size-4" />
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </section>

    <section class="space-y-2">
      <Label id="project-settings-tags-label" for="project-settings-tags">{{ t('projects.settings.tags') }}</Label>
      <div id="project-settings-tags" aria-labelledby="project-settings-tags-label"><TagPicker :model-value="project.tags" :can-create="project.can_manage" labelledby="project-settings-tags-label" @update:model-value="onTagsChange" /></div>
    </section>

    <Separator />

  </div>
</template>
