<script setup lang="ts">
import type { TaskState } from '@liwan/contracts'
import { taskStateBadge } from '@/composables/taskState'
import { badgeLabel } from '@liwan/ui/app/utils/statusBadge'
import type { TaskDetail } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useTaskDependencies, useTaskDependencyCandidates, useUpdateTaskDependencies } from '@/composables/useTaskDependencies'

const props = defineProps<{ task: TaskDetail }>()
const { t } = useI18n()
const stateBadge = (state: TaskState) => { const entry = taskStateBadge(state); return { tone: entry.tone, label: badgeLabel(entry, state, t) } }
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
          <UButton v-if="hasNextPage" color="neutral" variant="outline" block :loading="isFetchingNextPage" :disabled="isFetchingNextPage" :label="t('taskLifecycle.loadMore')" @click="fetchNextPage()" />
        </template>
      </USelectMenu>
    </header>

    <div class="space-y-3">
      <ul v-if="dependencies.length" class="grid gap-1">
        <li v-for="dep in dependencies" :key="dep.id" class="flex min-w-0 items-center gap-2 rounded-lg border border-transparent p-0.5 transition-colors hover:border-default hover:bg-elevated focus-within:border-primary">
          <SharedStatusBadge v-bind="stateBadge(dep.state)" />
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ dep.name }}</span>
          <UButton
            v-if="task.can_manage_dependencies"
            color="neutral"
            variant="ghost"
            size="sm"
            square
            type="button"
            icon="i-lucide-x"
            :aria-label="t('taskLifecycle.removeDependency')"
            :disabled="!hydrated || isPending"
            @click="remove(dep.id)"
          />
        </li>
      </ul>
      <p v-else class="py-2 text-sm text-muted">{{ t('tasks.detail.noDependencies') }}</p>
    </div>
  </section>
</template>
