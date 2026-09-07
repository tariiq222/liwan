<script setup lang="ts">
import { Search, X, Folder, CheckSquare } from '@lucide/vue'
import { useQuery, useInfiniteQuery } from '@tanstack/vue-query'
import { refDebounced, useEventListener } from '@vueuse/core'
import { returnToQuery } from '@/utils/safeReturnTo'
import { ProjectRefSchema, TaskListSchema } from '@nasq/contracts'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger, DialogClose } from '@/components/ui/dialog'

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
function focusSearch(event: Event) {
  event.preventDefault()
  document.getElementById('global-search-input')?.focus()
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <Button :aria-label="t('app.search')" variant="outline" size="sm" class="nasq-search-trigger" :disabled="!hydrated">
        <span class="flex min-w-0 items-center gap-2"><Search aria-hidden="true" /><span class="truncate">{{ t('app.search') }}</span></span>
        <kbd dir="ltr" class="pointer-events-none rounded border border-border bg-background px-1.5 font-mono text-[10px]">⌘K</kbd>
      </Button>
    </DialogTrigger>
    <DialogContent :dir="localeProperties.dir" :show-close-button="false" class="nasq-search-dialog" @open-auto-focus="focusSearch">
      <DialogTitle class="sr-only">{{ t('app.search') }}</DialogTitle>
      <DialogDescription class="sr-only">{{ t('search.description') }}</DialogDescription>

      <div class="nasq-search-bar">
        <Search class="nasq-search-bar-icon" aria-hidden="true" />
        <Input id="global-search-input" v-model="query" :aria-label="t('app.search')" :placeholder="t('search.description')" class="nasq-search-input" autocomplete="off" />
        <DialogClose as-child>
          <Button variant="ghost" size="icon" class="nasq-search-close" :aria-label="t('search.close')"><X aria-hidden="true" /></Button>
        </DialogClose>
      </div>

      <div class="nasq-search-results" aria-live="polite">
        <section v-if="nav.length" class="nasq-search-section">
          <h2 class="nasq-search-section-title">
            <span>{{ t('nav.goTo') }}</span>
            <span class="nasq-search-group-count" aria-hidden="true">{{ nav.length }}</span>
          </h2>
          <div :class="['nasq-search-nav-list', { 'nasq-search-nav-list--grid': !trimmed }]">
            <template v-for="item in nav" :key="item.to">
              <a v-if="item.to === '/odoo'" :href="item.to" target="_blank" rel="noopener" class="nasq-search-result" :title="navLabel(item)" @click="open = false">
                <span class="nasq-search-result-icon"><component :is="item.icon" aria-hidden="true" /></span>
                <span class="nasq-search-result-label">{{ navLabel(item) }}</span>
              </a>
              <NuxtLink v-else :to="item.to" class="nasq-search-result" :title="navLabel(item)" @click="open = false">
                <span class="nasq-search-result-icon"><component :is="item.icon" aria-hidden="true" /></span>
                <span class="nasq-search-result-label">{{ navLabel(item) }}</span>
              </NuxtLink>
            </template>
          </div>
        </section>

        <section v-if="trimmed && can('pmo.projects.read') && (projects.length || projectsQuery.isLoading.value || projectsQuery.error.value)" class="nasq-search-section">
          <h2 class="nasq-search-section-title">
            <span>{{ t('nav.projects') }}</span>
            <span class="nasq-search-group-count" aria-hidden="true">{{ projects.length }}</span>
          </h2>
          <p v-if="(projectsQuery.data.value?.length ?? 0) >= 200" class="nasq-search-note" role="status">{{ t('projects.capped') }}</p>
          <SharedPageState :loading="projectsQuery.isLoading.value" :error="projectsQuery.error.value" @retry="projectsQuery.refetch()" />
          <NuxtLink v-for="project in projects" :key="project.id" :to="{ path: `/projects/${project.id}`, query: returnToQuery(route.fullPath) }" class="nasq-search-result" :title="project.name" @click="open = false">
            <span class="nasq-search-result-icon"><Folder aria-hidden="true" /></span>
            <span class="nasq-search-result-label">{{ project.name }}</span>
          </NuxtLink>
        </section>

        <section v-if="trimmed && can('pmo.tasks.read') && (tasks.length || waiting || tasksQuery.error.value)" class="nasq-search-section">
          <h2 class="nasq-search-section-title">
            <span>{{ t('nav.tasks') }}</span>
            <span class="nasq-search-group-count" aria-hidden="true">{{ tasks.length }}</span>
          </h2>
          <SharedPageState :loading="waiting" :error="tasksQuery.error.value" @retry="tasksQuery.refetch()" />
          <NuxtLink v-for="task in tasks" :key="task.id" :to="{ path: `/tasks/${task.id}`, query: returnToQuery(route.fullPath) }" class="nasq-search-result" :title="task.name" @click="open = false">
            <span class="nasq-search-result-icon"><CheckSquare aria-hidden="true" /></span>
            <span class="nasq-search-result-label">{{ task.name }}</span>
          </NuxtLink>
          <Button v-if="tasksQuery.hasNextPage.value" variant="outline" class="nasq-search-load-more" :disabled="tasksQuery.isFetchingNextPage.value" @click="tasksQuery.fetchNextPage()">{{ t('app.loadMore') }}</Button>
        </section>

        <p v-if="!nav.length && !projects.length && !tasks.length && (!trimmed || (!waiting && !projectsQuery.isLoading.value && !projectsQuery.error.value && !tasksQuery.error.value))" class="nasq-search-empty">{{ t('app.noResults') }}</p>
      </div>
    </DialogContent>
  </Dialog>
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
  border-radius: 20px;
  padding: 0;
}

.nasq-search-bar {
  display: flex;
  min-height: 64px;
  flex-shrink: 0;
  align-items: center;
  gap: 0.625rem;
  border-bottom: 1px solid var(--border);
  padding: 0.625rem 0.75rem;
}

.nasq-search-bar-icon {
  width: 1.125rem;
  height: 1.125rem;
  flex: 0 0 auto;
  color: var(--muted-foreground);
}

.nasq-search-input {
  height: 44px;
  min-width: 0;
  flex: 1;
  border-color: transparent;
  border-radius: 12px;
  padding-inline: 0.25rem;
  font-size: 1rem;
  box-shadow: none;
}

.nasq-search-input:focus-visible {
  border-color: transparent;
  outline: none;
  box-shadow: none;
}

.nasq-search-bar:focus-within {
  border-bottom-color: var(--ring);
  box-shadow: inset 0 -1px var(--ring);
}

.nasq-search-close {
  flex: 0 0 auto;
  color: var(--muted-foreground);
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
  color: var(--muted-foreground);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.25rem;
}

.nasq-search-group-count {
  min-width: 1.25rem;
  border-radius: 999px;
  background: var(--muted);
  padding: 0 0.375rem;
  text-align: center;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
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
  display: flex;
  min-width: 0;
  min-height: 44px;
  align-items: center;
  gap: 0.625rem;
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 0.375rem 0.5rem;
  color: var(--foreground);
  font-size: 1rem;
  line-height: 1.25rem;
  text-decoration: none;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.nasq-search-result:hover,
.nasq-search-result:focus-visible {
  border-color: var(--border);
  background: color-mix(in srgb, var(--muted) 62%, transparent);
  outline: none;
}

.nasq-search-result:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ring) 42%, transparent);
}

.nasq-search-result-icon {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--muted) 58%, transparent);
  color: var(--muted-foreground);
}

.nasq-search-result-icon :deep(svg) {
  width: 1rem;
  height: 1rem;
}

.nasq-search-result-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.nasq-search-note {
  margin: 0 0 0.375rem;
  padding-inline: 0.5rem;
  color: var(--muted-foreground);
  font-size: 0.75rem;
  line-height: 1.125rem;
}

.nasq-search-load-more {
  width: 100%;
  margin-top: 0.375rem;
}

.nasq-search-empty {
  padding: 2.5rem 1rem;
  color: var(--muted-foreground);
  text-align: center;
  font-size: 1rem;
}

@media (max-width: 639px) {
  .nasq-search-nav-list--grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
