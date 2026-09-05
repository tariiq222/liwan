<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { ProjectRefSchema } from '@nasq/contracts'
import { safeReturnTo } from '@/utils/safeReturnTo'
import { firstAllowedPath } from '@/utils/accessPolicy'
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
useEventListener('keydown', (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey || query.value) return
  const item = available.value.find(item => item.shortcut === event.key)
  if (!item) return
  event.preventDefault()
  if (item.to === '/odoo') window.open(item.to, '_blank', 'noopener')
  else void navigateTo(item.to)
})
</script>
<template>
  <section class="mx-auto max-w-4xl space-y-6" data-testid="search-page">
    <SharedPageHeader :title="t('app.search')" :back-to="backTo" />
    <div class="space-y-2"><Label for="navigation-search">{{ t('nav.typeToNavigate') }}</Label><Input id="navigation-search" v-model="query" :placeholder="t('nav.typeToNavigate')" autofocus /></div>
    <section class="space-y-2"><h2 class="text-sm font-semibold text-muted-foreground">{{ t('nav.goTo') }}</h2><div class="grid gap-2 sm:grid-cols-2"><template v-for="item in nav" :key="item.to"><a v-if="item.to === '/odoo'" :href="item.to" target="_blank" rel="noopener" class="rounded-lg border p-4">{{ t(item.labelKey) }}</a><NuxtLink v-else :to="item.to" class="flex items-center gap-3 rounded-lg border p-4 hover:bg-muted"><component :is="item.icon" class="size-4 text-muted-foreground" />{{ t(item.labelKey) }}<kbd class="ms-auto text-xs text-muted-foreground">{{ item.shortcut }}</kbd></NuxtLink></template></div></section>
    <SharedPageState v-if="can('pmo.projects.read')" :loading="isLoading" :error="error" @retry="refetch()" />
    <section v-if="can('pmo.projects.read') && matchingProjects.length" class="space-y-2"><h2 class="text-sm font-semibold text-muted-foreground">{{ t('nav.projects') }}</h2><NuxtLink v-for="project in matchingProjects" :key="project.id" :to="`/projects/${project.id}`" class="block rounded-lg border p-4 hover:bg-muted">{{ project.name }}</NuxtLink></section>
    <p v-if="!nav.length && !matchingProjects.length && !isLoading && !error" class="text-sm text-muted-foreground">{{ t('app.noResults') }}</p>
  </section>
</template>
