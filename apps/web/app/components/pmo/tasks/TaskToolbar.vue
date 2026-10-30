<script setup lang="ts">
import type { TaskState } from '@webvue/contracts'
import { refDebounced } from '@vueuse/core'
import type { TaskListParams } from '@/composables/useTasks'
import { PRIORITY_LABEL_KEY, STATE_LABEL_KEY } from '@/composables/taskState'
import { CLOSED_TASK_STATES, OPEN_TASK_STATES, parsePriorities, TASK_DEADLINES, TASK_PRIORITIES, taskAttributeFilterCount, type TaskPriority } from '@/composables/taskFilterParams'
import { useProjects } from '@/composables/useProjects'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'

const props = defineProps<{ modelValue: TaskListParams; hideProjectFilter?: boolean; embedded?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [TaskListParams]; search: [string] }>()
const { t } = useI18n()
const hydrated = useHydrated()

const { data: projects } = useProjects()

// Each scope offers just the states it can contain.
const ALL_STATES = computed(() => (props.modelValue.closed ? CLOSED_TASK_STATES : OPEN_TASK_STATES))

function patch(changes: Partial<TaskListParams>) {
  emit('update:modelValue', { ...props.modelValue, ...changes })
}

const selectedStates = computed(() => props.modelValue.state ?? [])
const selectedProject = computed(() => (projects.value ?? []).find((project) => project.id === props.modelValue.project_id) ?? null)
const activeFilterCount = computed(() => Number(Boolean(props.modelValue.q)) + selectedStates.value.length + Number(!props.hideProjectFilter && Boolean(props.modelValue.project_id)) + taskAttributeFilterCount(props.modelValue))

// Priority is a multi-select (an empty selection is "all"); assignee and deadline are single choices whose
// "all" item clears the filter, so the closed trigger shows the field's name until something is chosen.
const selectedPriorities = computed(() => props.modelValue.priority ?? [])
const priorityItems = computed(() => TASK_PRIORITIES.map((p) => ({ value: p, label: t(PRIORITY_LABEL_KEY[p]) })))
function onPrioritiesChange(value: TaskPriority[]) {
  patch({ priority: parsePriorities(value) })
}
function removePriority(p: TaskPriority) {
  patch({ priority: parsePriorities(selectedPriorities.value.filter((priority) => priority !== p)) })
}

// A person picked from a link (`?assignee=<id>`) stays applied; choosing one here is not offered yet.
const assigneeValue = computed(() => (typeof props.modelValue.assignee === 'number' ? 'person' : props.modelValue.assignee))
const assigneeItems = computed(() => [
  { value: 'all', label: t('tasks.filters.assigneeAll') },
  { value: 'me', label: t('tasks.filters.assigneeMe') },
  { value: 'none', label: t('tasks.filters.assigneeNone') },
  ...(typeof props.modelValue.assignee === 'number' ? [{ value: 'person', label: t('tasks.filters.assigneePerson'), disabled: true }] : []),
])
function onAssigneeChange(value: string) {
  if (value === 'person') return
  patch({ assignee: value === 'me' || value === 'none' ? value : undefined })
}

const DEADLINE_LABEL_KEY = { overdue: 'tasks.filters.deadlineOverdue', today: 'tasks.deadline.today', week: 'tasks.filters.deadlineWeek', none: 'tasks.deadline.none' } as const
const deadlineItems = computed(() => [
  { value: 'all', label: t('tasks.filters.deadlineAll') },
  ...TASK_DEADLINES.map((d) => ({ value: d, label: t(DEADLINE_LABEL_KEY[d]) })),
])
function onDeadlineChange(value: string) {
  patch({ deadline: TASK_DEADLINES.find((d) => d === value) })
}
const assigneeChipLabel = computed(() => t(assigneeValue.value === 'me' ? 'tasks.filters.assigneeMe' : assigneeValue.value === 'none' ? 'tasks.filters.assigneeNone' : 'tasks.filters.assigneePerson'))

// A multi-select dropdown: an empty selection is "all states" (no filter).
const stateItems = computed(() => ALL_STATES.value.map((s) => ({ value: s, label: t(STATE_LABEL_KEY[s]) })))
function onStatesChange(value: TaskState[]) {
  patch({ state: value.length ? value : undefined })
}
// Switching scope drops a state filter the other scope cannot contain, so it never silently empties the list.
function setScope(closed: boolean) {
  if (Boolean(props.modelValue.closed) === closed) return
  patch({ closed, state: undefined })
}
const scopeItems = computed(() => [
  { value: 'open', label: t('tasks.filters.open') },
  { value: 'closed', label: t('tasks.filters.closed') },
])
function removeState(s: TaskState) {
  const states = selectedStates.value.filter((state) => state !== s)
  patch({ state: states.length ? states : undefined })
}

// The debounce is about the network request, not the input's responsiveness:
// `search` updates every keystroke for a snappy field, while `debouncedSearch`
// (and therefore `modelValue.q`) only settles 300ms after typing stops.
const search = ref(props.modelValue.q ?? '')
watch(search, value => emit('search', value), { flush: 'sync' })
const debouncedSearch = refDebounced(search, 300)
watch(debouncedSearch, (q) => patch({ q: q || undefined }))
// If params are reset from elsewhere (e.g. restored from localStorage after
// this component mounted), keep the visible input in sync.
watch(
  () => props.modelValue.q,
  (q) => {
    if ((q ?? '') !== search.value) search.value = q ?? ''
  },
)

function clearFilters() {
  search.value = ''
  patch({ q: undefined, state: undefined, project_id: props.hideProjectFilter ? props.modelValue.project_id : undefined, assignee: undefined, deadline: undefined, priority: undefined })
}

function clearSearch() {
  search.value = ''
  patch({ q: undefined })
}

const projectItems = computed(() => [
  { label: t('tasks.filters.allProjects'), value: 'all' },
  ...(projects.value ?? []).map((p) => ({ label: p.name, value: String(p.id) })),
])
</script>

<template>
  <div class="w-full min-w-0">
  <FilterBar class="w-full" :embedded="embedded" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
    <template #search>
      <UInput v-model="search" icon="i-lucide-search" :disabled="!hydrated" :aria-label="t('tasks.filters.search')" :placeholder="t('tasks.filters.search')" class="min-w-48 flex-1">
        <template v-if="search" #trailing>
          <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('tasks.filters.clearSearch')" class="-me-1" @click="clearSearch" />
        </template>
      </UInput>
    </template>

    <template #default>
      <USelect
        multiple
        class="w-full md:w-44"
        data-testid="task-filter-state"
        :disabled="!hydrated"
        :items="stateItems"
        :model-value="selectedStates"
        :placeholder="t('tasks.filters.allStates')"
        :aria-label="t('tasks.filters.stateLabel')"
        @update:model-value="onStatesChange"
      >
        <template v-if="selectedStates.length > 1" #default>{{ t('tasks.filters.selectedStates', { count: selectedStates.length }) }}</template>
      </USelect>

      <USelect
        v-if="!hideProjectFilter"
        id="task-filter-project"
        class="w-full md:w-44"
        :disabled="!hydrated"
        :items="projectItems"
        :model-value="modelValue.project_id ? String(modelValue.project_id) : 'all'"
        :placeholder="t('tasks.filters.allProjects')"
        :aria-label="t('tasks.filters.projectLabel')"
        @update:model-value="(v) => patch({ project_id: v === 'all' ? undefined : Number(v) })"
      />

      <USelect
        multiple
        icon="i-lucide-flag"
        class="w-full md:w-40"
        data-testid="task-filter-priority"
        :disabled="!hydrated"
        :items="priorityItems"
        :model-value="selectedPriorities"
        :placeholder="t('tasks.filters.priorityLabel')"
        :aria-label="t('tasks.filters.priorityLabel')"
        @update:model-value="onPrioritiesChange"
      >
        <template v-if="selectedPriorities.length > 1" #default>{{ t('tasks.filters.selectedPriorities', { count: selectedPriorities.length }) }}</template>
      </USelect>

      <USelect
        icon="i-lucide-user"
        class="w-full md:w-40"
        data-testid="task-filter-assignee"
        :disabled="!hydrated"
        :items="assigneeItems"
        :model-value="assigneeValue"
        :placeholder="t('tasks.filters.assigneeLabel')"
        :aria-label="t('tasks.filters.assigneeLabel')"
        @update:model-value="onAssigneeChange"
      />

      <USelect
        icon="i-lucide-calendar-clock"
        class="w-full md:w-40"
        data-testid="task-filter-deadline"
        :disabled="!hydrated"
        :items="deadlineItems"
        :model-value="modelValue.deadline"
        :placeholder="t('tasks.filters.deadlineLabel')"
        :aria-label="t('tasks.filters.deadlineLabel')"
        @update:model-value="onDeadlineChange"
      />
    </template>

    <!-- The embedded bar shows each choice in its dropdown, so no chip row repeats it. -->
    <template v-if="!embedded" #active>
      <div v-if="modelValue.q || selectedStates.length || selectedPriorities.length || modelValue.assignee !== undefined || modelValue.deadline || (!hideProjectFilter && selectedProject)" class="flex flex-wrap items-center gap-2">
        <SharedFilterChip v-if="modelValue.q" :label="t('tasks.filters.searchValue', { value: modelValue.q })" @remove="clearSearch" />
        <SharedFilterChip v-for="state in selectedStates" :key="state" :label="t(STATE_LABEL_KEY[state])" @remove="removeState(state)" />
        <SharedFilterChip v-if="!hideProjectFilter && selectedProject" :label="selectedProject.name" @remove="patch({ project_id: undefined })" />
        <SharedFilterChip v-for="priority in selectedPriorities" :key="`priority-${priority}`" :label="t('tasks.filters.chip', { label: t('tasks.filters.priorityLabel'), value: t(PRIORITY_LABEL_KEY[priority]) })" @remove="removePriority(priority)" />
        <SharedFilterChip v-if="modelValue.assignee !== undefined" :label="t('tasks.filters.chip', { label: t('tasks.filters.assigneeLabel'), value: assigneeChipLabel })" @remove="patch({ assignee: undefined })" />
        <SharedFilterChip v-if="modelValue.deadline" :label="t('tasks.filters.chip', { label: t('tasks.filters.deadlineLabel'), value: t(DEADLINE_LABEL_KEY[modelValue.deadline]) })" @remove="patch({ deadline: undefined })" />
      </div>
    </template>

    <template #actions><slot name="actions" /></template>

    <template #view>
      <SharedSegmentedControl
        data-testid="task-scope"
        :label="t('tasks.filters.scopeLabel')"
        :items="scopeItems"
        :model-value="modelValue.closed ? 'closed' : 'open'"
        @update:model-value="setScope($event === 'closed')"
      />
    </template>
  </FilterBar>
  </div>
</template>
