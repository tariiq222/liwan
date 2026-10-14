<script setup lang="ts">
import type { TaskState } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import type { TaskListParams } from '@/composables/useTasks'
import { STATE_LABEL_KEY } from '@/composables/taskState'
import { useProjects } from '@/composables/useProjects'
import FilterBar from '@/components/shared/FilterBar.vue'

const props = defineProps<{ modelValue: TaskListParams; hideProjectFilter?: boolean; embedded?: boolean; collapsible?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [TaskListParams] }>()
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

// "All states" is the first chip and stands for an empty state filter. Picking
// it clears the selection; picking a state while "all" is shown replaces it.
const stateChoiceItems = computed(() => [
  { value: 'all', label: t('tasks.filters.allStates') },
  ...ALL_STATES.value.map((s) => ({ value: s, label: t(STATE_LABEL_KEY[s]) })),
])
const stateChoiceValue = computed(() => (selectedStates.value.length ? [...selectedStates.value] : ['all']))
function onStatesChange(value: string | string[]) {
  const next = Array.isArray(value) ? value : [value]
  if (selectedStates.value.length && next.includes('all')) {
    patch({ state: undefined })
    return
  }
  const states = ALL_STATES.value.filter((s) => next.includes(s))
  patch({ state: states.length ? states : undefined })
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
  <FilterBar class="w-full" :inline="embedded && !collapsible" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
    <template #search>
      <div class="relative min-w-48 flex-1">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute start-2 top-1/2 size-4.5 -translate-y-1/2 text-muted" aria-hidden="true" />
        <UInput v-model="search" :disabled="!hydrated" :aria-label="t('tasks.filters.search')" :placeholder="t('tasks.filters.search')" class="w-full" :ui="{ base: 'ps-8' }" />
      </div>
    </template>

    <template #default>
      <SharedFilterChoice
        class="w-full"
        :label="t('tasks.filters.stateLabel')"
        :items="stateChoiceItems"
        :model-value="stateChoiceValue"
        :disabled="!hydrated"
        @update:model-value="onStatesChange"
      />

      <SharedFilterField v-if="!hideProjectFilter" :label="t('tasks.filters.projectLabel')" for="task-filter-project">
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
    </template>

    <template #active>
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
