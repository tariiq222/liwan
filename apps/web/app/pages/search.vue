<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { ProjectRefSchema } from '@nasq/contracts'
import { safeReturnTo } from '@/utils/safeReturnTo'
import { firstAllowedPath } from '@/utils/accessPolicy'
import { findSearchShortcut } from '@/composables/searchKeyboard'
import { useNav } from '@/composables/nav/shellModules'
const { t } = useI18n()
const { me } = useMe()
const { can } = useAccess()
const { $api } = useApi()
const route = useRoute()
const router = useRouter()
const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const backTo = computed(() => safeReturnTo(route.query.returnTo, firstAllowedPath(me.value), ['/tasks', '/projects', '/hr', '/settings', '/account']))
const available = computed(() => useNav(me.value))
const nav = computed(() => available.value.filter(item => t(item.labelKey).toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
const { data: projects, isLoading, error, refetch } = useQuery({ queryKey: ['search', 'projects'], enabled: computed(() => can('pmo.projects.read')), queryFn: () => $api('/api/v1/projects', { query: { minimal: 1 }, schema: ProjectRefSchema.array() }) })
const matchingProjects = computed(() => (projects.value ?? []).filter(p => p.name.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
watch(query, value => { void router.replace({ path: '/search', query: { ...route.query, q: value || undefined } }) })
watch(() => route.query.q, value => { query.value = typeof value === 'string' ? value : '' })
onMounted(async () => {
  // `autofocus` only runs when the browser inserts the input. Client-side
  // navigation keeps focus on the header trigger, so move it after the routed
  // page has mounted; the same hook also makes reload hydration deterministic.
  await nextTick()
  document.getElementById('navigation-search')?.focus()
})
useEventListener('keydown', (event: KeyboardEvent) => {
  const item = findSearchShortcut(event, query.value, available.value)
  if (!item) return
  event.preventDefault()
  if (item.to === '/odoo') window.open(item.to, '_blank', 'noopener')
  else void navigateTo(item.to)
})
</script>
<template>
  <SharedPageContainer width="form" data-testid="search-page">
    <SharedPageHeader :title="t('app.search')" :back-to="backTo" />
    <UInput id="navigation-search" v-model="query" class="w-full" size="lg" icon="i-lucide-search" :placeholder="t('nav.typeToNavigate')" autofocus :aria-label="t('nav.typeToNavigate')" />
    <section v-if="nav.length" class="grid gap-3">
      <h2 class="text-sm font-semibold text-muted">{{ t('nav.goTo') }}</h2>
      <div class="divide-y divide-default overflow-hidden rounded-lg bg-default ring ring-default">
        <template v-for="item in nav" :key="item.to">
          <a v-if="item.to === '/odoo'" :href="item.to" target="_blank" rel="noopener" class="flex items-center gap-3 p-3 transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><UIcon :name="item.icon" class="size-4.5 shrink-0 text-muted" aria-hidden="true" />{{ t(item.labelKey) }}<UKbd v-if="item.shortcut" class="ms-auto">{{ item.shortcut }}</UKbd></a>
          <NuxtLink v-else :to="item.to" class="flex items-center gap-3 p-3 transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><UIcon :name="item.icon" class="size-4.5 shrink-0 text-muted" aria-hidden="true" />{{ t(item.labelKey) }}<UKbd v-if="item.shortcut" class="ms-auto">{{ item.shortcut }}</UKbd></NuxtLink>
        </template>
      </div>
    </section>
    <div v-if="can('pmo.projects.read') && (isLoading || error)"><SharedPageState :loading="isLoading" :error="error" @retry="refetch()" /></div>
    <section v-if="can('pmo.projects.read') && matchingProjects.length" class="grid gap-3">
      <h2 class="text-sm font-semibold text-muted">{{ t('nav.projects') }}</h2>
      <div class="divide-y divide-default overflow-hidden rounded-lg bg-default ring ring-default">
        <NuxtLink v-for="project in matchingProjects" :key="project.id" :to="`/projects/${project.id}`" class="flex items-center gap-3 p-3 transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><UIcon name="i-lucide-folder" aria-hidden="true" class="size-4.5 shrink-0 text-muted" /><span class="min-w-0 flex-1 truncate">{{ project.name }}</span><UIcon name="i-lucide-arrow-left" aria-hidden="true" class="size-4.5 shrink-0 text-muted ltr:rotate-180" /></NuxtLink>
      </div>
    </section>
    <p v-if="!nav.length && !matchingProjects.length && !isLoading && !error" class="rounded-lg bg-default p-4 text-sm text-muted ring ring-default">{{ t('app.noResults') }}</p>
  </SharedPageContainer>
</template>
