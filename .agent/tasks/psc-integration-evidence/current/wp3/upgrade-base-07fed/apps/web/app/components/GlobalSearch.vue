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
const nav = computed(() => useNav(me.value).filter(item => t(item.labelKey).toLocaleLowerCase().includes(trimmed.value.toLocaleLowerCase())))
const projectsQuery = useQuery({
  queryKey: ['search', 'projects'],
  enabled: computed(() => open.value && can('pmo.projects.read')),
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
    <DialogContent :dir="localeProperties.dir" :show-close-button="false" class="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" @open-auto-focus="focusSearch">
      <div class="flex items-center justify-between border-b px-5 py-3">
        <DialogTitle class="font-semibold">{{ t('app.search') }}</DialogTitle>
        <DialogClose as-child><Button variant="ghost" size="icon" :aria-label="t('search.close')"><X /></Button></DialogClose>
      </div>
      <DialogDescription class="sr-only">{{ t('search.description') }}</DialogDescription>
      <div class="relative m-4">
        <Search class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input id="global-search-input" v-model="query" :aria-label="t('app.search')" :placeholder="t('search.description')" class="h-11 ps-10" autocomplete="off" />
      </div>
      <div class="min-h-0 overflow-y-auto px-4 pb-4" aria-live="polite">
        <section v-if="nav.length" class="mb-4 space-y-1">
          <h2 class="px-2 py-2 text-xs font-semibold text-muted-foreground">{{ t('nav.goTo') }}</h2>
          <template v-for="item in nav" :key="item.to">
            <a v-if="item.to === '/odoo'" :href="item.to" target="_blank" rel="noopener" class="flex items-center gap-3 rounded-lg p-3 hover:bg-muted focus-visible:bg-muted" @click="open = false"><component :is="item.icon" />{{ t(item.labelKey) }}</a>
            <NuxtLink v-else :to="item.to" class="flex items-center gap-3 rounded-lg p-3 hover:bg-muted focus-visible:bg-muted" @click="open = false"><component :is="item.icon" class="shrink-0 text-muted-foreground" />{{ t(item.labelKey) }}</NuxtLink>
          </template>
        </section>
        <section v-if="can('pmo.projects.read')" class="mb-4 space-y-1">
          <h2 class="px-2 py-2 text-xs font-semibold text-muted-foreground">{{ t('nav.projects') }}</h2>
          <p v-if="(projectsQuery.data.value?.length ?? 0) >= 200" class="px-2 text-xs text-muted-foreground" role="status">{{ t('projects.capped') }}</p>
          <SharedPageState :loading="projectsQuery.isLoading.value" :error="projectsQuery.error.value" @retry="projectsQuery.refetch()" />
          <NuxtLink v-for="project in projects" :key="project.id" :to="{ path: `/projects/${project.id}`, query: returnToQuery(route.fullPath) }" class="flex items-center gap-3 rounded-lg p-3 hover:bg-muted focus-visible:bg-muted" @click="open = false"><Folder class="shrink-0 text-muted-foreground" /><span>{{ project.name }}</span></NuxtLink>
        </section>
        <section v-if="trimmed && can('pmo.tasks.read')" class="space-y-1">
          <h2 class="px-2 py-2 text-xs font-semibold text-muted-foreground">{{ t('nav.tasks') }}</h2>
          <SharedPageState :loading="waiting" :error="tasksQuery.error.value" @retry="tasksQuery.refetch()" />
          <NuxtLink v-for="task in tasks" :key="task.id" :to="{ path: `/tasks/${task.id}`, query: returnToQuery(route.fullPath) }" class="flex items-center gap-3 rounded-lg p-3 hover:bg-muted focus-visible:bg-muted" @click="open = false"><CheckSquare class="shrink-0 text-muted-foreground" /><span>{{ task.name }}</span></NuxtLink>
          <Button v-if="tasksQuery.hasNextPage.value" variant="outline" class="mt-2 w-full" :disabled="tasksQuery.isFetchingNextPage.value" @click="tasksQuery.fetchNextPage()">{{ t('app.loadMore') }}</Button>
        </section>
        <p v-if="!nav.length && !projects.length && !tasks.length && !waiting && !projectsQuery.isLoading.value && !projectsQuery.error.value && !tasksQuery.error.value" class="py-8 text-center text-sm text-muted-foreground">{{ t('app.noResults') }}</p>
      </div>
    </DialogContent>
  </Dialog>
</template>
