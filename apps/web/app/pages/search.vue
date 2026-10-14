<script setup lang="ts">
import { safeReturnTo } from '@/utils/safeReturnTo'
import { firstAllowedPath } from '@/utils/accessPolicy'
import { findSearchShortcut } from '@/composables/searchKeyboard'
import { useNav } from '@/composables/nav/shellModules'
import { useAppSearch } from '@/composables/useAppSearch'
import { manifestRoutePrefixes } from '@/modules/surfaces'
const { t } = useI18n()
const { me } = useMe()
const { can } = useAccess()
const { $api } = useApi()
const route = useRoute()
const router = useRouter()
const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const backTo = computed(() => safeReturnTo(route.query.returnTo, firstAllowedPath(me.value), [...manifestRoutePrefixes(), '/settings', '/account']))
const available = computed(() => useNav(me.value))
const nav = computed(() => available.value.filter(item => t(item.labelKey).toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
const sections = useAppSearch({ surface: 'page', term: query, debounced: query, gate: true, requireTerm: false, can, api: $api })
const noResults = computed(() => !nav.value.length && sections.every(section => !section.rows.value.length && !section.loading.value && !section.error.value))
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
  <SharedRecordPage data-testid="search-page" :title="t('app.search')" :back-to="backTo">
    <UInput id="navigation-search" data-shortcut-search v-model="query" class="w-full" size="lg" icon="i-lucide-search" :placeholder="t('nav.typeToNavigate')" autofocus :aria-label="t('nav.typeToNavigate')" />
    <SharedRecordSection v-if="nav.length" :title="t('nav.goTo')">
      <div class="divide-y divide-default overflow-hidden rounded-lg bg-default ring ring-default">
        <template v-for="item in nav" :key="item.to">
          <a v-if="item.to === '/odoo'" :href="item.to" target="_blank" rel="noopener" class="flex items-center gap-3 p-3 transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><UIcon :name="item.icon" class="size-4.5 shrink-0 text-muted" aria-hidden="true" />{{ t(item.labelKey) }}<UKbd v-if="item.shortcut" class="ms-auto">{{ item.shortcut }}</UKbd></a>
          <NuxtLink v-else :to="item.to" class="flex items-center gap-3 p-3 transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><UIcon :name="item.icon" class="size-4.5 shrink-0 text-muted" aria-hidden="true" />{{ t(item.labelKey) }}<UKbd v-if="item.shortcut" class="ms-auto">{{ item.shortcut }}</UKbd></NuxtLink>
        </template>
      </div>
    </SharedRecordSection>
    <template v-for="section in sections" :key="section.provider.id">
      <div v-if="section.visible.value && (section.loading.value || section.error.value)"><SharedPageState :loading="section.loading.value" :error="section.error.value" @retry="section.refetch()" /></div>
      <SharedRecordSection v-if="section.visible.value && section.rows.value.length" :title="t(section.provider.labelKey)">
        <div class="divide-y divide-default overflow-hidden rounded-lg bg-default ring ring-default">
          <NuxtLink v-for="row in section.rows.value" :key="row.id" :to="{ path: row.to, query: { returnTo: route.fullPath } }" class="flex items-center gap-3 p-3 transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><UIcon :name="section.provider.icon" aria-hidden="true" class="size-4.5 shrink-0 text-muted" /><span class="min-w-0 flex-1 truncate">{{ row.label }}</span><UIcon name="i-lucide-arrow-left" aria-hidden="true" class="size-4.5 shrink-0 text-muted ltr:rotate-180" /></NuxtLink>
        </div>
      </SharedRecordSection>
    </template>
    <SharedEmptyState v-if="noResults" :title="t('app.noResults')" />
  </SharedRecordPage>
</template>
