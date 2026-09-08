<script setup lang="ts">
import { Search, Folder, ArrowLeft } from '@lucide/vue'
import { useQuery } from '@tanstack/vue-query'
import { ProjectRefSchema } from '@nasq/contracts'
import { safeReturnTo } from '@/utils/safeReturnTo'
import { firstAllowedPath } from '@/utils/accessPolicy'
import { findSearchShortcut } from '@/composables/searchKeyboard'
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
    <div class="nasq-panel nasq-panel-body relative">
      <Search aria-hidden="true" class="pointer-events-none absolute start-8 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
      <Label class="sr-only" for="navigation-search">{{ t('nav.typeToNavigate') }}</Label>
      <Input id="navigation-search" v-model="query" class="ps-10" :placeholder="t('nav.typeToNavigate')" autofocus />
    </div>
    <section v-if="nav.length" class="grid gap-3"><h2 class="text-sm font-semibold text-muted-foreground">{{ t('nav.goTo') }}</h2><div class="nasq-panel overflow-hidden"><template v-for="item in nav" :key="item.to"><a v-if="item.to === '/odoo'" :href="item.to" target="_blank" rel="noopener" class="flex items-center gap-3 border-b border-border/80 p-3 transition-colors last:border-0 hover:bg-muted/70"><component :is="item.icon" class="size-[18px] text-muted-foreground" />{{ t(item.labelKey) }}<kbd class="ms-auto text-xs text-muted-foreground">{{ item.shortcut }}</kbd></a><NuxtLink v-else :to="item.to" class="flex items-center gap-3 border-b border-border/80 p-3 transition-colors last:border-0 hover:bg-muted/70"><component :is="item.icon" class="size-[18px] text-muted-foreground" />{{ t(item.labelKey) }}<kbd class="ms-auto text-xs text-muted-foreground">{{ item.shortcut }}</kbd></NuxtLink></template></div></section>
    <div v-if="can('pmo.projects.read') && (isLoading || error)" class="nasq-panel"><SharedPageState :loading="isLoading" :error="error" @retry="refetch()" /></div>
    <section v-if="can('pmo.projects.read') && matchingProjects.length" class="grid gap-3"><h2 class="text-sm font-semibold text-muted-foreground">{{ t('nav.projects') }}</h2><div class="nasq-panel overflow-hidden"><NuxtLink v-for="project in matchingProjects" :key="project.id" :to="`/projects/${project.id}`" class="flex items-center gap-3 border-b border-border/80 p-3 transition-colors last:border-0 hover:bg-muted/70"><Folder aria-hidden="true" class="size-[18px] text-muted-foreground" /><span class="min-w-0 flex-1 truncate">{{ project.name }}</span><ArrowLeft aria-hidden="true" class="size-[18px] text-muted-foreground ltr:rotate-180" /></NuxtLink></div></section>
    <div v-if="!nav.length && !matchingProjects.length && !isLoading && !error" class="nasq-panel nasq-panel-body"><p class="text-sm text-muted-foreground">{{ t('app.noResults') }}</p></div>
  </SharedPageContainer>
</template>
