<script setup lang="ts">
import type { ProjectRegister, ProjectRegisterKind, ProjectRegisterPriority, ProjectRegisterStatus, ProjectRegisterWrite } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { usePeople } from '@/composables/usePeople'
import { useTasks, type TaskListParams } from '@/composables/useTasks'
import { useCreateProjectRegister, useUpdateProjectRegister } from '@/composables/useProjectGovernance'

const props = defineProps<{ projectId: number; item?: ProjectRegister }>()
const emit = defineEmits<{ saved: [item: ProjectRegister]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const kind = ref<ProjectRegisterKind>(props.item?.kind ?? 'risk')
const title = ref(props.item?.title ?? '')
const description = ref(props.item?.description ?? '')
const priority = ref<ProjectRegisterPriority>(props.item?.priority ?? 'normal')
const status = ref<ProjectRegisterStatus>(props.item?.status ?? 'open')
const dueDate = ref(props.item?.due_date ?? '')
const response = ref(props.item?.response ?? '')
const probability = ref(props.item?.probability ?? 3)
const impact = ref(props.item?.impact ?? 3)
const taskId = ref<number | null>(props.item?.task?.id ?? null)
const ownerId = ref<number | null>(props.item?.owner?.id ?? null)
const userQuery = ref('')
const taskQuery = ref('')
const taskClosed = ref(false)
const people = usePeople(userQuery)
const taskParams = computed<TaskListParams>(() => ({ closed: taskClosed.value, mine: false, project_id: props.projectId, q: taskQuery.value || undefined }))
const tasks = useTasks(taskParams)
const peopleOptions = computed(() => {
  const current = props.item?.owner
  const options = people.data.value?.map(user => ({ id: user.id, name: user.name })) ?? []
  if (current && !options.some(user => user.id === current.id)) options.unshift(current)
  return options
})
const taskOptions = computed(() => {
  const current = props.item?.task
  const options = tasks.data.value?.pages.flatMap(page => page.items).map(task => ({ id: task.id, name: task.name })) ?? []
  if (current && !options.some(task => task.id === current.id)) options.unshift(current)
  return options
})
const kindItems = computed(() => [
  { value: 'risk', label: t('projects.governance.register.risk') },
  { value: 'issue', label: t('projects.governance.register.issue') },
])
const priorityItems = computed(() => [
  { value: 'low', label: t('projects.governance.register.low') },
  { value: 'normal', label: t('projects.governance.register.normal') },
  { value: 'high', label: t('projects.governance.register.high') },
  { value: 'critical', label: t('projects.governance.register.critical') },
])
const statusItems = computed(() => [
  { value: 'open', label: t('projects.governance.register.open') },
  { value: 'in_progress', label: t('projects.governance.register.inProgress') },
  { value: 'resolved', label: t('projects.governance.register.resolved') },
  { value: 'closed', label: t('projects.governance.register.closed') },
])
const taskItems = computed(() => [
  { value: 'none', label: t('projects.governance.register.noTask') },
  ...taskOptions.value.map(task => ({ value: String(task.id), label: task.name })),
])
const ownerItems = computed(() => [
  { value: 'none', label: t('projects.governance.register.noOwner') },
  ...peopleOptions.value.map(user => ({ value: String(user.id), label: user.name })),
])
const taskSelect = computed({
  get: () => taskId.value == null ? 'none' : String(taskId.value),
  set: (value: string) => { taskId.value = value === 'none' ? null : Number(value) },
})
const ownerSelect = computed({
  get: () => ownerId.value == null ? 'none' : String(ownerId.value),
  set: (value: string) => { ownerId.value = value === 'none' ? null : Number(value) },
})
const dueModel = computed({
  get: () => dueDate.value || null,
  set: (value: string | null) => { dueDate.value = value ?? '' },
})
const baseline = JSON.stringify([kind.value, title.value, description.value, priority.value, status.value, dueDate.value, response.value, probability.value, impact.value, taskId.value, ownerId.value])
const submitted = ref(false)
const attempted = ref(false)
const requiredError = computed(() => attempted.value && !title.value.trim() ? t('projects.governance.register.titleRequired') : undefined)
const error = ref<string | null>(null)
const dirty = computed(() => !submitted.value && JSON.stringify([kind.value, title.value, description.value, priority.value, status.value, dueDate.value, response.value, probability.value, impact.value, taskId.value, ownerId.value]) !== baseline)
const create = useCreateProjectRegister()
const update = useUpdateProjectRegister()
const pending = computed(() => create.isPending.value || update.isPending.value)

async function submit() {
  if (!hydrated.value || pending.value) return
  attempted.value = true
  error.value = null
  if (!title.value.trim()) return
  const body: ProjectRegisterWrite = {
    kind: kind.value,
    title: title.value.trim(),
    description: description.value,
    priority: priority.value,
    status: status.value,
    due_date: dueDate.value || null,
    response: response.value,
    task_id: taskId.value,
    owner_id: ownerId.value,
    ...(kind.value === 'risk' ? { probability: Number(probability.value), impact: Number(impact.value) } : {}),
  }
  try {
    const item = props.item
      ? await update.mutateAsync({ projectId: props.projectId, id: props.item.id, body })
      : await create.mutateAsync({ projectId: props.projectId, body })
    submitted.value = true
    await nextTick()
    emit('saved', item)
  }
  catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <form novalidate class="space-y-8" @submit.prevent="submit">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection :title="t('projects.refresh.workspace.registerDetailsTitle')" :description="t('projects.refresh.workspace.registerDetailsDescription')">
      <div class="grid gap-5">
        <UFormField :label="t('projects.governance.register.kind')">
          <USelect id="register-kind" v-model="kind" :items="kindItems" class="w-full" :disabled="!hydrated || pending || !!item" />
        </UFormField>
        <UFormField :label="t('projects.governance.register.priority')">
          <USelect id="register-priority" v-model="priority" :items="priorityItems" class="w-full" :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField class="sm:col-span-2" :label="t('projects.governance.register.itemTitle')" required :error="requiredError">
          <UInput id="register-title" v-model="title" class="w-full" required :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField class="sm:col-span-2" :label="t('projects.governance.register.description')">
          <UTextarea id="register-description" v-model="description" class="w-full" :rows="4" :disabled="!hydrated || pending" />
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormSection :title="t('projects.refresh.workspace.registerOwnershipTitle')" :description="t('projects.refresh.workspace.registerOwnershipDescription')">
      <div class="grid gap-5">
        <UFormField :label="t('projects.governance.register.status')">
          <USelect id="register-status" v-model="status" :items="statusItems" class="w-full" :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField :label="t('projects.governance.register.dueDate')">
          <SharedDateField
            id="register-due-date"
            v-model="dueModel"
            :disabled="!hydrated || pending"
            :aria-label="t('projects.governance.register.dueDate')"
          />
        </UFormField>
        <UFormField :label="t('projects.governance.register.task')">
          <div class="grid gap-2">
            <UInput id="register-task-search" v-model="taskQuery" class="w-full" :placeholder="t('app.search')" :disabled="!hydrated || pending" />
            <UCheckbox id="register-task-closed" :model-value="taskClosed" :label="t('projects.governance.closedTasks')" :disabled="!hydrated || pending" @update:model-value="taskClosed = $event === true" />
            <USelect
              id="register-task"
              v-model="taskSelect"
              :items="taskItems"
              class="w-full"
              :aria-label="t('projects.governance.register.task')"
              :disabled="!hydrated || pending || tasks.isLoading.value"
            />
            <UButton v-if="tasks.hasNextPage.value" type="button" color="neutral" :disabled="!hydrated || pending || tasks.isFetchingNextPage.value" @click="tasks.fetchNextPage()" variant="outline">{{ t('projects.governance.loadMore') }}</UButton>
            <p v-if="tasks.isLoading.value" role="status" class="text-xs text-muted">{{ t('projects.loading') }}</p>
            <p v-else-if="tasks.error.value" role="alert" class="text-xs text-error">{{ t('projects.loadError') }}</p>
            <p v-else-if="!taskOptions.length" class="text-xs text-muted">{{ t('projects.governance.register.noTasks') }}</p>
          </div>
        </UFormField>
        <UFormField :label="t('projects.governance.register.owner')">
          <div class="grid gap-2">
            <UInput id="register-owner-search" v-model="userQuery" class="w-full" :placeholder="t('app.search')" :disabled="!hydrated || pending" />
            <USelect
              id="register-owner"
              v-model="ownerSelect"
              :items="ownerItems"
              class="w-full"
              :aria-label="t('projects.governance.register.owner')"
              :disabled="!hydrated || pending || people.isLoading.value"
            />
            <p v-if="people.isLoading.value" role="status" class="text-xs text-muted">{{ t('projects.loading') }}</p>
            <p v-else-if="people.error.value" role="alert" class="text-xs text-error">{{ t('projects.loadError') }}</p>
            <p v-else-if="!peopleOptions.length" class="text-xs text-muted">{{ t('projects.governance.register.noOwners') }}</p>
          </div>
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormSection v-if="kind === 'risk'" :title="t('projects.refresh.workspace.registerRiskTitle')" :description="t('projects.refresh.workspace.registerRiskDescription')">
      <div class="grid gap-5">
        <UFormField :label="t('projects.governance.register.probability')">
          <UInputNumber id="register-probability" v-model="probability" class="w-full" :min="1" :max="5" :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField :label="t('projects.governance.register.impact')">
          <UInputNumber id="register-impact" v-model="impact" class="w-full" :min="1" :max="5" :disabled="!hydrated || pending" />
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormSection :title="t('projects.refresh.workspace.registerPlanTitle')" :description="t('projects.refresh.workspace.registerPlanDescription')">
      <UFormField :label="t('projects.governance.register.response')">
        <UTextarea id="register-response" v-model="response" class="w-full" :rows="4" :disabled="!hydrated || pending" />
      </UFormField>
    </SharedFormSection>

    <SharedFormActions class="flex flex-wrap gap-2 justify-end">
      <UButton type="button" color="neutral" :disabled="!hydrated || pending" @click="emit('cancel')" variant="outline">{{ t('app.cancel') }}</UButton>
      <UButton type="submit" :disabled="!hydrated || pending" :loading="pending">{{ t('app.save') }}</UButton>
    </SharedFormActions>
  </form>
</template>
