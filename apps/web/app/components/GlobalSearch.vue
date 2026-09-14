<script setup lang="ts">
import { useQuery, useInfiniteQuery } from '@tanstack/vue-query'
import { refDebounced, useEventListener } from '@vueuse/core'
import { returnToQuery } from '@/utils/safeReturnTo'
import { useNav } from '@/composables/nav/shellModules'
import { ProjectRefSchema, TaskListSchema } from '@nasq/contracts'

const { t, localeProperties } = useI18n()
const { me } = useMe()
const { can } = useAccess()
const { $api } = useApi()
const route = useRoute()
const hydrated = useHydrated()
const open = ref(false)
const query = ref('')
const trimmed = computed(() => query.value.trim())
const debounced = refDebounced(trimmed, 200)
function navLabel(item: ReturnType<typeof useNav>[number]) {
  return item.to === '/settings/projects' ? t('nav.projectSettings') : t(item.labelKey)
}
const nav = computed(() => useNav(me.value).filter(item => navLabel(item).toLocaleLowerCase().includes(trimmed.value.toLocaleLowerCase())))
const projectsQuery = useQuery({
  queryKey: ['search', 'projects'],
  enabled: computed(() => open.value && can('pmo.projects.read') && !!debounced.value),
  queryFn: () => $api('/api/v1/projects', { query: { minimal: 1 }, schema: ProjectRefSchema.array() }),
})
const projects = computed(() => (projectsQuery.data.value ?? []).filter(item => item.name.toLocaleLowerCase().includes(trimmed.value.toLocaleLowerCase())))
const tasksQuery = useInfiniteQuery({
  queryKey: computed(() => ['search', 'tasks', debounced.value]),
  enabled: computed(() => open.value && can('pmo.tasks.read') && !!debounced.value),
  queryFn: ({ pageParam }) => $api('/api/v1/tasks', { query: { filter: 'mine', q: debounced.value, limit: 20, offset: pageParam }, schema: TaskListSchema }),
  initialPageParam: 0,
  getNextPageParam: (last, pages) => {
    const loaded = pages.reduce((count, page) => count + page.items.length, 0)
    return loaded < last.total ? loaded : undefined
  },
})
const tasks = computed(() => trimmed.value && trimmed.value === debounced.value ? (tasksQuery.data.value?.pages ?? []).flatMap(page => page.items) : [])
const waiting = computed(() => !!trimmed.value && (trimmed.value !== debounced.value || tasksQuery.isLoading.value))
watch(() => route.fullPath, () => { open.value = false })
watch(open, value => { if (value) query.value = '' })
useEventListener('keydown', (event: KeyboardEvent) => {
  if (hydrated.value && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    open.value = !open.value
  }
})
function focusSearch() {
  document.getElementById('global-search-input')?.focus()
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('app.search')"
    :description="t('search.description')"
    :ui="{ content: 'nasq-search-dialog max-w-2xl max-h-[min(620px,calc(100dvh-2rem))] gap-0 divide-y-0 overflow-hidden rounded-xl p-0', overlay: 'nasq-search-overlay' }"
    @after:enter="focusSearch"
  >
    <UButton :aria-label="t('app.search')" color="neutral" variant="outline" class="nasq-search-trigger" :disabled="!hydrated">
      <span class="flex min-w-0 items-center gap-2">
        <UIcon name="i-lucide-search" class="size-4 shrink-0" aria-hidden="true" />
        <span data-slot="label" class="nasq-search-trigger-label truncate">{{ t('app.search') }}</span>
      </span>
      <UKbd dir="ltr">⌘K</UKbd>
    </UButton>
    <template #content="{ close }">
      <div :dir="localeProperties.dir" class="flex max-h-[min(620px,calc(100dvh-2rem))] w-full flex-col overflow-hidden">
        <div class="flex min-h-16 shrink-0 items-center gap-2.5 border-b border-default px-3 py-2.5">
          <UIcon name="i-lucide-search" class="size-4.5 shrink-0 text-muted" aria-hidden="true" />
          <UInput
            id="global-search-input"
            v-model="query"
            :aria-label="t('app.search')"
            :placeholder="t('search.description')"
            class="min-w-0 flex-1"
            autocomplete="off"
            variant="none"
          />
          <UButton color="neutral" variant="ghost" square class="shrink-0 text-muted" :aria-label="t('search.close')" @click="close">
            <template #leading>
              <UIcon name="i-lucide-x" class="size-4.5" aria-hidden="true" />
            </template>
          </UButton>
        </div>

        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3" aria-live="polite">
          <section v-if="nav.length">
            <h2 class="mb-1.5 flex items-center gap-1.5 px-2 text-xs font-semibold text-muted">
              <span>{{ t('nav.goTo') }}</span>
              <UBadge color="neutral" variant="subtle" size="sm" aria-hidden="true">{{ nav.length }}</UBadge>
            </h2>
            <div class="grid gap-1" :class="{ 'sm:grid-cols-2': !trimmed }">
              <template v-for="item in nav" :key="item.to">
                <UButton
                  v-if="item.to === '/odoo'"
                  :href="item.to"
                  target="_blank"
                  rel="noopener"
                  color="neutral"
                  variant="ghost"
                  class="min-h-11 min-w-0 justify-start"
                  :title="navLabel(item)"
                  :label="navLabel(item)"
                  @click="open = false"
                >
                  <template #leading>
                    <UIcon :name="item.icon" class="size-4 shrink-0 text-muted" aria-hidden="true" />
                  </template>
                </UButton>
                <UButton
                  v-else
                  :to="item.to"
                  color="neutral"
                  variant="ghost"
                  class="min-h-11 min-w-0 justify-start"
                  :title="navLabel(item)"
                  :label="navLabel(item)"
                  @click="open = false"
                >
                  <template #leading>
                    <UIcon :name="item.icon" class="size-4 shrink-0 text-muted" aria-hidden="true" />
                  </template>
                </UButton>
              </template>
            </div>
          </section>

          <section v-if="trimmed && can('pmo.projects.read') && (projects.length || projectsQuery.isLoading.value || projectsQuery.error.value)" class="grid gap-1">
            <h2 class="mb-0.5 flex items-center gap-1.5 px-2 text-xs font-semibold text-muted">
              <span>{{ t('nav.projects') }}</span>
              <UBadge color="neutral" variant="subtle" size="sm" aria-hidden="true">{{ projects.length }}</UBadge>
            </h2>
            <p v-if="(projectsQuery.data.value?.length ?? 0) >= 200" class="px-2 text-xs text-muted" role="status">{{ t('projects.capped') }}</p>
            <SharedPageState :loading="projectsQuery.isLoading.value" :error="projectsQuery.error.value" @retry="projectsQuery.refetch()" />
            <UButton
              v-for="project in projects"
              :key="project.id"
              :to="{ path: `/projects/${project.id}`, query: returnToQuery(route.fullPath) }"
              color="neutral"
              variant="ghost"
              class="min-h-11 min-w-0 justify-start"
              :title="project.name"
              :label="project.name"
              @click="open = false"
            >
              <template #leading>
                <UIcon name="i-lucide-folder" class="size-4 shrink-0 text-muted" aria-hidden="true" />
              </template>
            </UButton>
          </section>

          <section v-if="trimmed && can('pmo.tasks.read') && (tasks.length || waiting || tasksQuery.error.value)" class="grid gap-1">
            <h2 class="mb-0.5 flex items-center gap-1.5 px-2 text-xs font-semibold text-muted">
              <span>{{ t('nav.tasks') }}</span>
              <UBadge color="neutral" variant="subtle" size="sm" aria-hidden="true">{{ tasks.length }}</UBadge>
            </h2>
            <SharedPageState :loading="waiting" :error="tasksQuery.error.value" @retry="tasksQuery.refetch()" />
            <UButton
              v-for="task in tasks"
              :key="task.id"
              :to="{ path: `/tasks/${task.id}`, query: returnToQuery(route.fullPath) }"
              color="neutral"
              variant="ghost"
              class="min-h-11 min-w-0 justify-start"
              :title="task.name"
              :label="task.name"
              @click="open = false"
            >
              <template #leading>
                <UIcon name="i-lucide-check-square" class="size-4 shrink-0 text-muted" aria-hidden="true" />
              </template>
            </UButton>
            <UButton
              v-if="tasksQuery.hasNextPage.value"
              color="neutral"
              variant="outline"
              block
              class="mt-1.5"
              :disabled="tasksQuery.isFetchingNextPage.value"
              :label="t('app.loadMore')"
              @click="tasksQuery.fetchNextPage()"
            />
          </section>

          <p v-if="!nav.length && !projects.length && !tasks.length && (!trimmed || (!waiting && !projectsQuery.isLoading.value && !projectsQuery.error.value && !tasksQuery.error.value))" class="px-4 py-10 text-center text-base text-muted">{{ t('app.noResults') }}</p>
        </div>
      </div>
    </template>
  </UModal>
</template>
