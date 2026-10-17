<script setup lang="ts">
import type { TaskState } from '@webvue/contracts'
import { refDebounced } from '@vueuse/core'
import type { TaskListParams } from '@/composables/useTasks'
import { STATE_LABEL_KEY } from '@/composables/taskState'
import { useProjects } from '@/composables/useProjects'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'

const props = defineProps<{ modelValue: TaskListParams; hideProjectFilter?: boolean; embedded?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [TaskListParams]; search: [string] }>()
const { t } = useI18n()
const hydrated = useHydrated()

const { data: projects } = useProjects()

// The open scope only holds unfinished tasks and the closed scope only done/cancelled ones (the API
// filters on is_closed), so each scope offers just the states it can contain.
const OPEN_STATES: TaskState[] = ['in_progress', 'waiting', 'changes_requested', 'approved']
const CLOSED_STATES: TaskState[] = ['done', 'cancelled']
const ALL_STATES = computed(() => (props.modelValue.closed ? CLOSED_STATES : OPEN_STATES))

function patch(changes: Partial<TaskListParams>) {
  emit('update:modelValue', { ...props.modelValue, ...changes })
}

const selectedStates = computed(() => props.modelValue.state ?? [])
const selectedProject = computed(() => (projects.value ?? []).find((project) => project.id === props.modelValue.project_id) ?? null)
const activeFilterCount = computed(() => Number(Boolean(props.modelValue.q)) + selectedStates.value.length + Number(!props.hideProjectFilter && Boolean(props.modelValue.project_id)))

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
  patch({ q: undefined, state: undefined, project_id: props.hideProjectFilter ? props.modelValue.project_id : undefined })
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
      <div class="relative min-w-48 flex-1">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute start-2 top-1/2 size-4.5 -translate-y-1/2 text-muted" aria-hidden="true" />
        <UInput v-model="search" :disabled="!hydrated" :aria-label="t('tasks.filters.search')" :placeholder="t('tasks.filters.search')" class="w-full" :ui="{ base: 'ps-8' }" />
      </div>
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
    </template>

    <!-- The embedded bar shows each choice in its dropdown, so no chip row repeats it. -->
    <template v-if="!embedded" #active>
      <div v-if="modelValue.q || selectedStates.length || (!hideProjectFilter && selectedProject)" class="flex flex-wrap items-center gap-2">
        <SharedFilterChip v-if="modelValue.q" :label="t('tasks.filters.searchValue', { value: modelValue.q })" @remove="clearSearch" />
        <SharedFilterChip v-for="state in selectedStates" :key="state" :label="t(STATE_LABEL_KEY[state])" @remove="removeState(state)" />
        <SharedFilterChip v-if="!hideProjectFilter && selectedProject" :label="selectedProject.name" @remove="patch({ project_id: undefined })" />
      </div>
    </template>

    <template #actions><slot name="actions" /></template>

    <template #view>
      <div role="group" data-testid="task-scope" class="inline-flex items-center gap-0.5 rounded-md bg-elevated/40 p-0.5 ring ring-default" :aria-label="t('tasks.filters.scopeLabel')">
        <UButton
          v-for="scope in [{ value: false, label: t('tasks.filters.open') }, { value: true, label: t('tasks.filters.closed') }]"
          :key="String(scope.value)"
          type="button"
          color="neutral"
          size="sm"
          :variant="Boolean(modelValue.closed) === scope.value ? 'soft' : 'ghost'"
          :aria-pressed="Boolean(modelValue.closed) === scope.value"
          :disabled="!hydrated"
          @click="setScope(scope.value)"
        >{{ scope.label }}</UButton>
      </div>
    </template>
  </FilterBar>
  </div>
</template>
