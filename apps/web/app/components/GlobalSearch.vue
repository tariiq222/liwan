<script setup lang="ts">
import { Search, X, Folder, CheckSquare } from '@lucide/vue'
import { useQuery, useInfiniteQuery } from '@tanstack/vue-query'
import { refDebounced, useEventListener } from '@vueuse/core'
import { returnToQuery } from '@/utils/safeReturnTo'
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
    :ui="{ content: 'nasq-search-dialog', overlay: 'nasq-search-overlay' }"
    @after:enter="focusSearch"
  >
    <UButton :aria-label="t('app.search')" color="neutral" variant="outline" class="nasq-search-trigger" :disabled="!hydrated">
      <span class="flex min-w-0 items-center gap-2">
        <Search aria-hidden="true" />
        <span class="truncate">{{ t('app.search') }}</span>
      </span>
      <UKbd dir="ltr">⌘K</UKbd>
    </UButton>
    <template #content="{ close }">
      <div :dir="localeProperties.dir" class="flex max-h-[min(620px,calc(100dvh-2rem))] w-full flex-col overflow-hidden">
        <div class="nasq-search-bar">
          <Search class="nasq-search-bar-icon" aria-hidden="true" />
          <UInput
            id="global-search-input"
            v-model="query"
            :aria-label="t('app.search')"
            :placeholder="t('search.description')"
            class="nasq-search-input"
            autocomplete="off"
            variant="none"
          />
          <UButton color="neutral" variant="ghost" square class="nasq-search-close" :aria-label="t('search.close')" @click="close">
            <template #leading>
              <X aria-hidden="true" />
            </template>
          </UButton>
        </div>

        <div class="nasq-search-results" aria-live="polite">
          <section v-if="nav.length" class="nasq-search-section">
            <h2 class="nasq-search-section-title">
              <span>{{ t('nav.goTo') }}</span>
              <UBadge color="neutral" variant="subtle" size="sm" aria-hidden="true">{{ nav.length }}</UBadge>
            </h2>
            <div :class="['nasq-search-nav-list', { 'nasq-search-nav-list--grid': !trimmed }]">
              <template v-for="item in nav" :key="item.to">
                <UButton
                  v-if="item.to === '/odoo'"
                  :href="item.to"
                  target="_blank"
                  rel="noopener"
                  color="neutral"
                  variant="ghost"
                  class="nasq-search-result"
                  :title="navLabel(item)"
                  :label="navLabel(item)"
                  @click="open = false"
                >
                  <template #leading>
                    <span class="nasq-search-result-icon"><component :is="item.icon" aria-hidden="true" /></span>
                  </template>
                </UButton>
                <UButton
                  v-else
                  :to="item.to"
                  color="neutral"
                  variant="ghost"
                  class="nasq-search-result"
                  :title="navLabel(item)"
                  :label="navLabel(item)"
                  @click="open = false"
                >
                  <template #leading>
                    <span class="nasq-search-result-icon"><component :is="item.icon" aria-hidden="true" /></span>
                  </template>
                </UButton>
              </template>
            </div>
          </section>

          <section v-if="trimmed && can('pmo.projects.read') && (projects.length || projectsQuery.isLoading.value || projectsQuery.error.value)" class="nasq-search-section">
            <h2 class="nasq-search-section-title">
              <span>{{ t('nav.projects') }}</span>
              <UBadge color="neutral" variant="subtle" size="sm" aria-hidden="true">{{ projects.length }}</UBadge>
            </h2>
            <p v-if="(projectsQuery.data.value?.length ?? 0) >= 200" class="nasq-search-note" role="status">{{ t('projects.capped') }}</p>
            <SharedPageState :loading="projectsQuery.isLoading.value" :error="projectsQuery.error.value" @retry="projectsQuery.refetch()" />
            <UButton
              v-for="project in projects"
              :key="project.id"
              :to="{ path: `/projects/${project.id}`, query: returnToQuery(route.fullPath) }"
              color="neutral"
              variant="ghost"
              class="nasq-search-result"
              :title="project.name"
              :label="project.name"
              @click="open = false"
            >
              <template #leading>
                <span class="nasq-search-result-icon"><Folder aria-hidden="true" /></span>
              </template>
            </UButton>
          </section>

          <section v-if="trimmed && can('pmo.tasks.read') && (tasks.length || waiting || tasksQuery.error.value)" class="nasq-search-section">
            <h2 class="nasq-search-section-title">
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
              class="nasq-search-result"
              :title="task.name"
              :label="task.name"
              @click="open = false"
            >
              <template #leading>
                <span class="nasq-search-result-icon"><CheckSquare aria-hidden="true" /></span>
              </template>
            </UButton>
            <UButton
              v-if="tasksQuery.hasNextPage.value"
              color="secondary"
              variant="solid"
              class="nasq-search-load-more"
              :disabled="tasksQuery.isFetchingNextPage.value"
              :label="t('app.loadMore')"
              @click="tasksQuery.fetchNextPage()"
            />
          </section>

          <p v-if="!nav.length && !projects.length && !tasks.length && (!trimmed || (!waiting && !projectsQuery.isLoading.value && !projectsQuery.error.value && !tasksQuery.error.value))" class="nasq-search-empty">{{ t('app.noResults') }}</p>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
:global(.nasq-search-dialog) {
  display: flex;
  width: min(640px, calc(100vw - 2rem));
  max-width: min(640px, calc(100vw - 2rem));
  max-height: min(620px, calc(100dvh - 2rem));
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  border-radius: calc(var(--ui-radius) * 3);
  padding: 0;
}

.nasq-search-bar {
  display: flex;
  min-height: 64px;
  flex-shrink: 0;
  align-items: center;
  gap: 0.625rem;
  border-bottom: 1px solid var(--ui-border);
  padding: 0.625rem 0.75rem;
}

.nasq-search-bar-icon {
  width: 1.125rem;
  height: 1.125rem;
  flex: 0 0 auto;
  color: var(--ui-text-muted);
}

.nasq-search-input {
  min-width: 0;
  flex: 1;
}

.nasq-search-close {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
}

.nasq-search-results {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
  overscroll-behavior: contain;
}

.nasq-search-section + .nasq-search-section {
  margin-top: 1rem;
}

.nasq-search-section-title {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin: 0 0 0.375rem;
  padding-inline: 0.5rem;
  color: var(--ui-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1.25rem;
}


.nasq-search-nav-list {
  display: grid;
  gap: 0.25rem;
}

.nasq-search-nav-list--grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.nasq-search-result {
  min-width: 0;
  min-height: 44px;
  justify-content: start;
}

.nasq-search-result-icon {
  display: inline-flex;
  width: 1.25rem;
  height: 1.25rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  color: var(--ui-text-muted);
}

.nasq-search-result-icon :deep(svg) {
  width: 1rem;
  height: 1rem;
}

.nasq-search-note {
  margin: 0 0 0.375rem;
  padding-inline: 0.5rem;
  color: var(--ui-text-muted);
  font-size: var(--text-xs);
  line-height: 1.125rem;
}

.nasq-search-load-more {
  width: 100%;
  margin-top: 0.375rem;
}

.nasq-search-empty {
  padding: 2.5rem 1rem;
  color: var(--ui-text-muted);
  text-align: center;
  font-size: 1rem;
}

@media (max-width: 639px) {
  .nasq-search-nav-list--grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
