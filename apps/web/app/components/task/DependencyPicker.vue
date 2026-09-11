<script setup lang="ts">
import { X } from '@lucide/vue'
import type { TaskDetail } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useTaskDependencies, useTaskDependencyCandidates, useUpdateTaskDependencies } from '@/composables/useTaskDependencies'
import StateBadge from './StateBadge.vue'

const props = defineProps<{ task: TaskDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const q = ref('')
const taskId = computed(() => props.task.id)
const { data: dependencyState } = useTaskDependencies(taskId)
const { data: candidates, hasNextPage, fetchNextPage, isFetchingNextPage } = useTaskDependencyCandidates(taskId, q)
const { mutate: update, isPending } = useUpdateTaskDependencies()

const dependencies = computed(() => dependencyState.value?.items ?? props.task.depends_on)
const selected = computed(() => new Set(dependencies.value.map((d) => d.id)))
const available = computed(() => (candidates.value?.pages ?? []).flatMap((page) => page.items))

const availableItems = computed(() => available.value.map((candidate) => ({ label: candidate.name, value: candidate.id })))

function commit(ids: number[]) {
  update({ id: props.task.id, ids }, { onError: (error) => toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' }) })
}
function remove(id: number) {
  commit([...selected.value].filter((value) => value !== id))
}

</script>

<template>
  <section class="space-y-3" data-testid="dependency-picker">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold text-highlighted">{{ t('taskLifecycle.dependencies') }} <span class="text-xs font-normal text-muted">{{ dependencies.length }}</span></h2>
      <USelectMenu
        v-if="task.can_manage_dependencies"
        v-model:search-term="q"
        :model-value="[...selected]"
        :items="availableItems"
        :ignore-filter="true"
        multiple
        value-key="value"
        variant="outline"
        size="sm"
        :placeholder="t('taskLifecycle.addDependency')"
        :aria-label="t('taskLifecycle.addDependency')"
        :search-input="{ placeholder: t('app.search') }"
        :disabled="!hydrated || isPending || !dependencyState?.enabled"
        @update:model-value="commit"
      >
        <template #default><span class="truncate">{{ t('taskLifecycle.addDependency') }}</span></template>
        <template #content-bottom>
          <UButton v-if="hasNextPage" color="neutral" variant="outline" block :disabled="isFetchingNextPage" :label="t('taskLifecycle.loadMore')" @click="fetchNextPage()" />
        </template>
      </USelectMenu>
    </header>

    <div class="space-y-3">
      <ul v-if="dependencies.length" class="task-list">
        <li v-for="dep in dependencies" :key="dep.id" class="task-dependency-row">
          <StateBadge :state="dep.state" />
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ dep.name }}</span>
          <UButton
            v-if="task.can_manage_dependencies"
            variant="ghost"
            size="sm"
            type="button"
            :aria-label="t('taskLifecycle.removeDependency')"
            :disabled="!hydrated || isPending"
            @click="remove(dep.id)"
          >
            <X class="size-[18px]" />
          </UButton>
        </li>
      </ul>
      <p v-else class="task-empty-inline">{{ t('tasks.detail.noDependencies') }}</p>
    </div>
  </section>
</template>

<style scoped>
.task-list {
  display: grid;
  gap: 4px;
}

.task-dependency-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 3px;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.task-dependency-row:hover {
  border-color: var(--ui-border);
  background: var(--ui-bg-muted);
}

.task-dependency-row:focus-within {
  border-color: var(--ui-primary);
}

.task-empty-inline {
  padding: 10px 0;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
}
</style>
