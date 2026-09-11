<script setup lang="ts">
import type { TaskState } from '@nasq/contracts'
import { LayoutGrid, List, Search } from '@lucide/vue'
import { refDebounced } from '@vueuse/core'
import type { TaskListParams } from '@/composables/useTasks'
import { STATE_LABEL_KEY } from '@/composables/taskState'
import { useProjects } from '@/composables/useProjects'
import FilterBar from '@/components/shared/FilterBar.vue'

const props = defineProps<{ modelValue: TaskListParams; hideProjectFilter?: boolean; view?: 'table' | 'board'; embedded?: boolean; collapsible?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [TaskListParams]; 'update:view': ['table' | 'board'] }>()
const { t } = useI18n()
const hydrated = useHydrated()

const { data: projects } = useProjects()

const ALL_STATES: TaskState[] = ['in_progress', 'waiting', 'changes_requested', 'approved', 'done', 'cancelled']

function patch(changes: Partial<TaskListParams>) {
  emit('update:modelValue', { ...props.modelValue, ...changes })
}

const selectedStates = computed(() => props.modelValue.state ?? [])
const stateFilterLabel = computed(() => {
  const states = selectedStates.value
  if (states.length === 1) return t(STATE_LABEL_KEY[states[0]!])
  if (states.length > 1) return t('tasks.filters.selectedStates', { count: states.length })
  return t('tasks.filters.allStates')
})
const selectedProject = computed(() => (projects.value ?? []).find((project) => project.id === props.modelValue.project_id) ?? null)
const activeFilterCount = computed(() => Number(Boolean(props.modelValue.q)) + selectedStates.value.length + Number(!props.hideProjectFilter && Boolean(props.modelValue.project_id)))
function toggleState(s: TaskState, checked: boolean) {
  const next = new Set(selectedStates.value)
  if (checked) next.add(s)
  else next.delete(s)
  patch({ state: next.size ? [...next] : undefined })
}

// The debounce is about the network request, not the input's responsiveness:
// `search` updates every keystroke for a snappy field, while `debouncedSearch`
// (and therefore `modelValue.q`) only settles 300ms after typing stops.
const search = ref(props.modelValue.q ?? '')
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
  patch({ q: undefined, state: undefined, project_id: props.hideProjectFilter ? props.modelValue.project_id : undefined })
}

const stateMenuItems = computed(() => ALL_STATES.map((s) => ({
  label: t(STATE_LABEL_KEY[s]),
  type: 'checkbox' as const,
  checked: selectedStates.value.includes(s),
  onUpdateChecked: (checked: boolean) => toggleState(s, checked),
  onSelect: (e: Event) => e.preventDefault(),
})))

const projectItems = computed(() => [
  { label: t('tasks.filters.allProjects'), value: 'all' },
  ...(projects.value ?? []).map((p) => ({ label: p.name, value: String(p.id) })),
])
</script>

<template>
  <div class="w-full min-w-0">
  <FilterBar class="w-full" :inline="embedded && !collapsible" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
    <template #search>
      <div class="relative min-w-48 flex-1">
        <Search class="pointer-events-none absolute start-2 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
        <UInput v-model="search" :disabled="!hydrated" :aria-label="t('tasks.filters.search')" :placeholder="t('tasks.filters.search')" class="w-full" :ui="{ base: 'ps-8' }" />
      </div>
    </template>

    <template #default>
      <UDropdownMenu :items="stateMenuItems" :content="{ align: 'start' }">
        <UButton variant="outline" :disabled="!hydrated">{{ stateFilterLabel }}</UButton>
      </UDropdownMenu>

      <template v-if="!hideProjectFilter">
        <USelect
          class="w-40"
          :disabled="!hydrated"
          :items="projectItems"
          :model-value="modelValue.project_id ? String(modelValue.project_id) : 'all'"
          :placeholder="t('tasks.filters.allProjects')"
          @update:model-value="(v) => patch({ project_id: v === 'all' ? undefined : Number(v) })"
        />
      </template>

    </template>

    <template #active>
      <div v-if="modelValue.q || selectedStates.length || (!hideProjectFilter && selectedProject)" class="flex flex-wrap items-center gap-2">
        <UBadge v-if="modelValue.q" variant="subtle">{{ t('tasks.filters.searchValue', { value: modelValue.q }) }}</UBadge>
        <UBadge v-for="state in selectedStates" :key="state" variant="subtle">{{ t(STATE_LABEL_KEY[state]) }}</UBadge>
        <UBadge v-if="!hideProjectFilter && selectedProject" variant="subtle">{{ selectedProject.name }}</UBadge>
      </div>
    </template>

    <template #actions><slot name="actions" /></template>

    <template #view>
      <slot name="view" />
      <div v-if="view" role="group" class="inline-flex min-h-10 items-center rounded-lg border bg-elevated/40 p-0.5" :aria-label="t('projects.filters.view')">
        <UButton data-testid="project-tasks-view-table" type="button" color="neutral" square size="sm" :variant="view === 'table' ? 'soft' : 'ghost'" :disabled="!hydrated" :aria-label="t('projects.filters.tableView')" :aria-pressed="view === 'table'" @click="emit('update:view', 'table')">
          <List class="size-[18px]" />
        </UButton>
        <UButton data-testid="project-tasks-view-board" type="button" color="neutral" square size="sm" :variant="view === 'board' ? 'soft' : 'ghost'" :disabled="!hydrated" :aria-label="t('projects.filters.boardView')" :aria-pressed="view === 'board'" @click="emit('update:view', 'board')">
          <LayoutGrid class="size-[18px]" />
        </UButton>
      </div>
      <UTabs
        :items="[{ label: t('tasks.filters.open'), value: 'open', disabled: !hydrated }, { label: t('tasks.filters.closed'), value: 'closed', disabled: !hydrated }]"
        :model-value="modelValue.closed ? 'closed' : 'open'"
        @update:model-value="(v) => patch({ closed: v === 'closed' })"
      />
    </template>
  </FilterBar>
  </div>
</template>
