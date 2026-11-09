<script setup lang="ts">
import type { TaskState } from '@liwan/contracts'
import { refDebounced } from '@vueuse/core'
import type { TaskListParams } from '@/composables/useTasks'
import { PRIORITY_LABEL_KEY, STATE_LABEL_KEY } from '@/composables/taskState'
import { CLOSED_TASK_STATES, OPEN_TASK_STATES, parsePriorities, TASK_DEADLINES, TASK_PRIORITIES, taskFilterChipRemoval, taskFilterChips, type TaskFilterChip, type TaskPriority } from '@/composables/taskFilterParams'
import type { TaskColumnId, TaskTableVariant } from '@/composables/taskColumns'
import type { TaskScope } from '@/composables/taskScope'
import { useProjects } from '@/composables/useProjects'
import { useTaskColumns } from '@/composables/useTaskColumns'
import { LIST_VIEW_KEY } from '@liwan/ui/app/utils/listView'

/*
 * The task list toolbar, one row: the search, one «فلاتر» button with the count of active filters (it opens a popover
 * with state, priority, assignee, deadline and, on the all-projects list, project), the scope group (open / finished,
 * and archived when the host passes `scope`) and, at the end, the «الأعمدة» menu (table view only) and the view switch
 * of the page (icons). The active filters are removable chips under the row, drawn only when any is set.
 * The timeline view has no list to filter: the `timeline` slot then takes the place of the search, filters and scope.
 * Archived tasks are only searchable, so that scope keeps just the search and the scope group.
 * `scope` is controlled by the host (it also owns the archived query); without it the group is open / finished and
 * writes `closed` into the params, as the all-projects list always did.
 */
const props = withDefaults(defineProps<{
  modelValue: TaskListParams
  hideProjectFilter?: boolean
  variant?: TaskTableVariant
  scope?: TaskScope
}>(), { variant: 'mine' })
const emit = defineEmits<{ 'update:modelValue': [TaskListParams]; 'update:scope': [TaskScope]; search: [string] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const listView = inject(LIST_VIEW_KEY, null)
const columns = useTaskColumns(props.variant)

const { data: projects } = useProjects()

const scopeValue = computed<TaskScope>(() => props.scope ?? (props.modelValue.closed ? 'closed' : 'open'))
const view = computed(() => listView?.view.value)
const timeline = computed(() => view.value === 'timeline')
const archived = computed(() => scopeValue.value === 'archived')
const filterable = computed(() => !timeline.value && !archived.value)
const showColumns = computed(() => filterable.value && (view.value === undefined || view.value === 'table'))
const projectFilter = computed(() => !props.hideProjectFilter)

function patch(changes: Partial<TaskListParams>) {
  emit('update:modelValue', { ...props.modelValue, ...changes })
}

// Each scope offers just the states it can contain.
const ALL_STATES = computed(() => (props.modelValue.closed ? CLOSED_TASK_STATES : OPEN_TASK_STATES))
const selectedStates = computed(() => props.modelValue.state ?? [])
const selectedPriorities = computed(() => props.modelValue.priority ?? [])
const chips = computed(() => taskFilterChips(props.modelValue, projectFilter.value))
const filterCount = computed(() => chips.value.length)

const stateItems = computed(() => ALL_STATES.value.map((s) => ({ value: s, label: t(STATE_LABEL_KEY[s]) })))
function onStatesChange(value: string | string[]) {
  const states = (Array.isArray(value) ? value : []) as TaskState[]
  patch({ state: states.length ? states : undefined })
}

const priorityItems = computed(() => TASK_PRIORITIES.map((p) => ({ value: p, label: t(PRIORITY_LABEL_KEY[p]) })))
function onPrioritiesChange(value: string | string[]) {
  patch({ priority: parsePriorities(value) })
}

// A person picked from a link (`?assignee=<id>`) stays applied; choosing one here is not offered yet.
const assigneeValue = computed(() => (typeof props.modelValue.assignee === 'number' ? 'person' : (props.modelValue.assignee ?? 'all')))
const assigneeItems = computed(() => [
  { value: 'all', label: t('tasks.filters.assigneeAll') },
  { value: 'me', label: t('tasks.filters.assigneeMe') },
  { value: 'none', label: t('tasks.filters.assigneeNone') },
  ...(typeof props.modelValue.assignee === 'number' ? [{ value: 'person', label: t('tasks.filters.assigneePerson'), disabled: true }] : []),
])
function onAssigneeChange(value: string | string[]) {
  if (value === 'person') return
  patch({ assignee: value === 'me' || value === 'none' ? value : undefined })
}

const DEADLINE_LABEL_KEY = { overdue: 'tasks.filters.deadlineOverdue', today: 'tasks.deadline.today', week: 'tasks.filters.deadlineWeek', none: 'tasks.deadline.none' } as const
const deadlineItems = computed(() => [
  { value: 'all', label: t('tasks.filters.deadlineAll') },
  ...TASK_DEADLINES.map((d) => ({ value: d, label: t(DEADLINE_LABEL_KEY[d]) })),
])
function onDeadlineChange(value: string | string[]) {
  patch({ deadline: TASK_DEADLINES.find((d) => d === value) })
}

const projectItems = computed(() => [
  { label: t('tasks.filters.allProjects'), value: 'all' },
  ...(projects.value ?? []).map((p) => ({ label: p.name, value: String(p.id) })),
])

function chipLabel(chip: TaskFilterChip): string {
  switch (chip.kind) {
    case 'state': return t(STATE_LABEL_KEY[chip.value as TaskState])
    case 'project': return (projects.value ?? []).find((project) => String(project.id) === chip.value)?.name ?? t('tasks.filters.projectLabel')
    case 'priority': return t('tasks.filters.chip', { label: t('tasks.filters.priorityLabel'), value: t(PRIORITY_LABEL_KEY[chip.value as TaskPriority]) })
    case 'assignee': return t('tasks.filters.chip', { label: t('tasks.filters.assigneeLabel'), value: t(chip.value === 'me' ? 'tasks.filters.assigneeMe' : chip.value === 'none' ? 'tasks.filters.assigneeNone' : 'tasks.filters.assigneePerson') })
    case 'deadline': return t('tasks.filters.chip', { label: t('tasks.filters.deadlineLabel'), value: t(DEADLINE_LABEL_KEY[chip.value as keyof typeof DEADLINE_LABEL_KEY]) })
  }
}
function removeChip(chip: TaskFilterChip) {
  patch(taskFilterChipRemoval(props.modelValue, chip))
}
function clearFilters() {
  patch({ state: undefined, project_id: props.hideProjectFilter ? props.modelValue.project_id : undefined, assignee: undefined, deadline: undefined, priority: undefined })
}

// Switching scope drops a state filter the other scope cannot contain, so it never silently empties the list.
function setScope(next: string) {
  if (next === scopeValue.value) return
  if (props.scope) emit('update:scope', next as TaskScope)
  else patch({ closed: next === 'closed', state: undefined })
}
const scopeItems = computed(() => [
  { value: 'open', label: t('tasks.filters.open') },
  { value: 'closed', label: t('tasks.filters.closed') },
  ...(props.scope ? [{ value: 'archived', label: t('tasks.filters.archived') }] : []),
])

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
function clearSearch() {
  search.value = ''
  patch({ q: undefined })
}

// The «الأعمدة» menu: one checkbox per optional column; a choice keeps the menu open so several can be changed at once.
const columnItems = computed(() => [columns.options.map((id) => ({
  type: 'checkbox' as const,
  label: t(`tasks.columns.${id}`),
  checked: columns.visible.value.includes(id),
  onUpdateChecked: (on: boolean) => columns.set(id as TaskColumnId, on),
  onSelect: (event: Event) => event.preventDefault(),
}))])
</script>

<template>
  <div data-slot="filter-root" data-variant="embedded" class="@container/filters w-full min-w-0 space-y-2" data-testid="task-toolbar">
    <div data-slot="filter-row" class="flex flex-wrap items-center gap-2.5">
      <template v-if="timeline">
        <slot name="timeline" />
      </template>
      <template v-else>
        <div data-slot="search" data-shortcut-search class="min-w-0 flex-1 *:w-full max-md:basis-full md:min-w-55 md:basis-55">
          <UInput v-model="search" icon="i-lucide-search" :disabled="!hydrated" :aria-label="t('tasks.filters.search')" :placeholder="t('tasks.filters.search')">
            <template v-if="search" #trailing>
              <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('tasks.filters.clearSearch')" class="-me-1" @click="clearSearch" />
            </template>
          </UInput>
        </div>

        <UPopover v-if="filterable" modal :content="{ align: 'start' }" :ui="{ content: 'w-[min(92vw,26rem)] p-4' }">
          <UButton
            type="button"
            color="neutral"
            variant="soft"
            icon="i-lucide-list-filter"
            data-testid="task-filters-button"
            :label="t('tasks.filters.button')"
            :disabled="!hydrated"
          >
            <template v-if="filterCount > 0" #trailing>
              <UBadge color="primary" size="sm" data-testid="task-filters-count" aria-hidden="true">{{ filterCount }}</UBadge>
            </template>
          </UButton>
          <template #content>
            <div class="space-y-4" role="group" :aria-label="t('tasks.filters.title')" data-testid="task-filters-popover">
              <div class="flex items-center justify-between gap-2">
                <h2 class="text-sm font-semibold text-highlighted">{{ t('tasks.filters.title') }}</h2>
                <UButton v-if="filterCount > 0" type="button" color="neutral" variant="link" size="sm" icon="i-lucide-rotate-ccw" data-testid="task-filters-clear" :label="t('tasks.filters.clear')" @click="clearFilters" />
              </div>
              <SharedFilterChoice data-testid="task-filter-state" :label="t('tasks.filters.stateLabel')" :items="stateItems" :model-value="selectedStates" :disabled="!hydrated" @update:model-value="onStatesChange" />
              <SharedFilterChoice data-testid="task-filter-priority" :label="t('tasks.filters.priorityLabel')" :items="priorityItems" :model-value="selectedPriorities" :disabled="!hydrated" @update:model-value="onPrioritiesChange" />
              <SharedFilterChoice data-testid="task-filter-assignee" :label="t('tasks.filters.assigneeLabel')" :items="assigneeItems" :model-value="assigneeValue" :disabled="!hydrated" @update:model-value="onAssigneeChange" />
              <SharedFilterChoice data-testid="task-filter-deadline" :label="t('tasks.filters.deadlineLabel')" :items="deadlineItems" :model-value="modelValue.deadline ?? 'all'" :disabled="!hydrated" @update:model-value="onDeadlineChange" />
              <SharedFilterField v-if="projectFilter" :label="t('tasks.filters.projectLabel')" for="task-filter-project">
                <USelect
                  id="task-filter-project"
                  class="w-full"
                  :disabled="!hydrated"
                  :items="projectItems"
                  :model-value="modelValue.project_id ? String(modelValue.project_id) : 'all'"
                  :placeholder="t('tasks.filters.allProjects')"
                  @update:model-value="(v) => patch({ project_id: v === 'all' ? undefined : Number(v) })"
                />
              </SharedFilterField>
            </div>
          </template>
        </UPopover>
        <span class="sr-only" role="status" aria-live="polite" data-testid="task-filters-live">{{ filterCount > 0 ? t('tasks.filters.activeCount', { count: filterCount }, filterCount) : '' }}</span>

        <SharedSegmentedControl data-testid="task-scope" :label="t('tasks.filters.scopeLabel')" :items="scopeItems" :model-value="scopeValue" @update:model-value="setScope" />
      </template>

      <div data-slot="view" class="flex min-w-0 flex-wrap items-center gap-2 max-md:w-full max-md:justify-between md:ms-auto">
        <UDropdownMenu v-if="showColumns" :items="columnItems" :content="{ align: 'end' }">
          <UButton type="button" color="neutral" variant="soft" class="font-medium" icon="i-lucide-columns-3" data-testid="task-columns-button" :label="t('tasks.filters.columns')" :disabled="!hydrated" />
        </UDropdownMenu>
        <SharedSegmentedControl v-if="listView && !archived" icon-only data-testid="task-view-switch" :label="t('states.view')" :items="[...listView.options]" :model-value="listView.view.value ?? ''" @update:model-value="listView.setView" />
      </div>
    </div>

    <div v-if="filterable && chips.length" data-slot="active-row" class="flex flex-wrap items-center gap-2 text-xs text-muted" data-testid="task-filter-chips" role="group" :aria-label="t('tasks.filters.activeLabel')">
      <SharedFilterChip v-for="chip in chips" :key="chip.id" :label="chipLabel(chip)" @remove="removeChip(chip)" />
      <UButton type="button" color="neutral" variant="link" size="xs" :disabled="!hydrated" :label="t('tasks.filters.clear')" @click="clearFilters" />
    </div>
  </div>
</template>
