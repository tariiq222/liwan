<script setup lang="ts">
import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
import { refDebounced } from '@vueuse/core'
import { searchProviders } from '@/modules/surfaces'
import { visibleCommands } from '@/composables/nav/paletteModel'
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
const debounced = refDebounced(query, 250)
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/', ['/', ...manifestRoutePrefixes(), '/settings', '/account']))
const available = computed(() => useNav(me.value))
const nav = computed(() => available.value.filter(item => t(item.labelKey).toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
const selectedProvider = computed(() => {
  const id = typeof route.query.provider === 'string' ? route.query.provider : undefined
  return searchProviders().some(provider => provider.id === id && can(provider.capability)) ? id : undefined
})
const providerItems = computed(() => [
  { value: '', label: t('search.allProviders') },
  ...searchProviders().filter(provider => can(provider.capability)).map(provider => ({ value: provider.id, label: t(provider.labelKey) })),
])
function setProvider(id: string) {
  void router.replace({ path: '/search', query: { ...route.query, provider: id || undefined } })
}
const sections = useAppSearch({ term: query, debounced, provider: selectedProvider, gate: true, requireTerm: true, can, api: $api })
// The page list is a shortcut, not the point of the page: five rows until the user asks for the rest.
const NAV_LIMIT = 5
const showAllNav = ref(false)
const visibleNav = computed(() => (showAllNav.value ? nav.value : nav.value.slice(0, NAV_LIMIT)))
const noResults = computed(() => !!query.value.trim() && !nav.value.length && sections.filter(section => section.visible.value).every(section => !section.rows.value.length && !section.waiting.value && !section.error.value))
const actions = computed(() => visibleCommands(me.value))
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
  void navigateTo(item.to)
})
</script>
<template>
  <SharedRecordPage data-testid="search-page" :title="t('app.search')" :back-to="backTo">
    <UInput id="navigation-search" data-shortcut-search v-model="query" class="w-full" size="lg" icon="i-lucide-search" :placeholder="t('nav.typeToNavigate')" autofocus :aria-label="t('nav.typeToNavigate')" />
    <SharedEmptyState v-if="noResults" bordered :title="t('app.noResults')" />
    <SharedListCard v-else>
      <template v-if="providerItems.length > 1" #filters>
        <SharedSegmentedControl :model-value="selectedProvider ?? ''" :items="providerItems" :label="t('search.providerFilter')" data-testid="search-providers" @update:model-value="setProvider" />
      </template>
      <!-- Results first: what the user searched for, then the shortcut list of pages. -->
      <template v-for="section in sections" :key="section.provider.id">
        <div v-if="query.trim() && section.visible.value && (section.waiting.value || section.error.value)" class="border-t border-default p-4 first:border-t-0"><SharedPageState :loading="section.waiting.value && !section.rows.value.length" :error="section.error.value" @retry="section.refetch()" /></div>
        <section v-if="query.trim() && section.visible.value && section.rows.value.length" class="min-w-0 border-t border-default first:border-t-0 [[data-slot=list-card-filters]+&]:border-t-0">
        <header class="flex items-center justify-between gap-3 bg-elevated/40 px-(--webvue-card-pad-dense) py-2">
          <h2 class="text-sm font-semibold text-highlighted">{{ t(section.provider.labelKey) }}</h2>
          <UBadge color="neutral" variant="subtle" size="sm" class="rounded-full tabular-nums" data-testid="search-group-count" :label="String(section.rows.value.length)" />
        </header>
        <div class="divide-y divide-default">
          <NuxtLink v-for="row in section.rows.value" :key="row.id" :to="{ path: row.to, query: { returnTo: route.fullPath } }" class="flex items-center gap-3 px-(--webvue-card-pad-dense) py-3 transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><UIcon :name="section.provider.icon" aria-hidden="true" class="size-4.5 shrink-0 text-muted" /><span class="min-w-0 flex-1 truncate">{{ row.label }}</span><UIcon name="i-lucide-arrow-left" aria-hidden="true" class="size-4.5 shrink-0 text-muted ltr:rotate-180" /></NuxtLink>
        </div>
        <div v-if="(section.truncated.value && section.provider.truncatedKey) || section.hasNext.value" class="flex flex-wrap items-center gap-3 border-t border-default px-(--webvue-card-pad-dense) py-3">
            <p v-if="section.truncated.value && section.provider.truncatedKey" role="status" class="text-sm text-muted">{{ t(section.provider.truncatedKey) }}</p>
            <UButton v-if="section.hasNext.value" type="button" color="neutral" variant="outline" size="sm" :loading="section.fetchingNext.value" :disabled="section.fetchingNext.value" :label="t('app.loadMore')" @click="section.fetchNext()" />
        </div>
      </section>
      </template>
      <section v-if="nav.length" class="min-w-0 border-t border-default first:border-t-0 [[data-slot=list-card-filters]+&]:border-t-0">
        <header class="flex items-center justify-between gap-3 bg-elevated/40 px-(--webvue-card-pad-dense) py-2">
          <h2 class="text-sm font-semibold text-highlighted">{{ t('nav.goTo') }}</h2>
          <UBadge color="neutral" variant="subtle" size="sm" class="rounded-full tabular-nums" data-testid="search-group-count" :label="String(nav.length)" />
        </header>
        <div class="divide-y divide-default"><template v-for="item in visibleNav" :key="item.to">
          <NuxtLink :to="item.to" class="flex items-center gap-3 px-(--webvue-card-pad-dense) py-3 transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><UIcon :name="item.icon" class="size-4.5 shrink-0 text-muted" aria-hidden="true" />{{ t(item.labelKey) }}<UKbd v-if="item.shortcut" dir="ltr" class="ms-auto">{{ item.shortcut.toLocaleUpperCase() }}</UKbd></NuxtLink>
        </template></div>
        <div v-if="nav.length > NAV_LIMIT" class="flex flex-wrap items-center gap-3 border-t border-default px-(--webvue-card-pad-dense) py-3">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            size="sm"
            data-testid="search-nav-toggle"
            :aria-expanded="showAllNav"
            :label="showAllNav ? t('nav.goToShowLess') : t('nav.goToShowAll', { count: nav.length })"
            @click="showAllNav = !showAllNav"
          />
        </div>
      </section>
      <section v-if="!query.trim() && actions.length" class="min-w-0 border-t border-default first:border-t-0 [[data-slot=list-card-filters]+&]:border-t-0">
        <header class="flex items-center justify-between gap-3 bg-elevated/40 px-(--webvue-card-pad-dense) py-2">
          <h2 class="text-sm font-semibold text-highlighted">{{ t('app.actions') }}</h2>
          <UBadge color="neutral" variant="subtle" size="sm" class="rounded-full tabular-nums" data-testid="search-group-count" :label="String(actions.length)" />
        </header>
        <div class="flex flex-wrap gap-2 px-(--webvue-card-pad-dense) py-3"><UButton v-for="action in actions" :key="action.id" :to="{ path: action.to, query: { returnTo: route.fullPath } }" :icon="action.icon" color="neutral" variant="outline" :label="t(action.labelKey)" /></div>
      </section>
    </SharedListCard>
  </SharedRecordPage>
</template>
