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
  if (item.to === '/odoo') window.open(item.to, '_blank', 'noopener')
  else void navigateTo(item.to)
})
</script>
<template>
  <SharedRecordPage data-testid="search-page" :title="t('app.search')" :back-to="backTo">
    <UInput id="navigation-search" data-shortcut-search v-model="query" class="w-full" size="lg" icon="i-lucide-search" :placeholder="t('nav.typeToNavigate')" autofocus :aria-label="t('nav.typeToNavigate')" />
    <!-- Results first: what the user searched for, then the shortcut list of pages. -->
    <UButton v-if="selectedProvider" :to="{ path: '/search', query: { ...route.query, provider: undefined } }" color="neutral" variant="outline" :label="t('search.allProviders')" />
    <template v-for="section in sections" :key="section.provider.id">
      <div v-if="query.trim() && section.visible.value && (section.waiting.value || section.error.value)"><SharedPageState :loading="section.waiting.value && !section.rows.value.length" :error="section.error.value" @retry="section.refetch()" /></div>
      <SharedRecordSection v-if="query.trim() && section.visible.value && section.rows.value.length" :title="t(section.provider.labelKey)">
        <div class="divide-y divide-default overflow-hidden rounded-lg bg-default ring ring-default">
          <NuxtLink v-for="row in section.rows.value" :key="row.id" :to="{ path: row.to, query: { returnTo: route.fullPath } }" class="flex items-center gap-3 p-3 transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><UIcon :name="section.provider.icon" aria-hidden="true" class="size-4.5 shrink-0 text-muted" /><span class="min-w-0 flex-1 truncate">{{ row.label }}</span><UIcon name="i-lucide-arrow-left" aria-hidden="true" class="size-4.5 shrink-0 text-muted ltr:rotate-180" /></NuxtLink>
        </div>
        <p v-if="section.truncated.value && section.provider.truncatedKey" role="status" class="text-sm text-muted">{{ t(section.provider.truncatedKey) }}</p>
        <UButton v-if="section.hasNext.value" type="button" color="neutral" variant="outline" :loading="section.fetchingNext.value" :disabled="section.fetchingNext.value" :label="t('app.loadMore')" @click="section.fetchNext()" />
      </SharedRecordSection>
    </template>
    <SharedRecordSection v-if="nav.length" :title="t('nav.goTo')">
      <div class="divide-y divide-default overflow-hidden rounded-lg bg-default ring ring-default">
        <template v-for="item in visibleNav" :key="item.to">
          <a v-if="item.to === '/odoo'" :href="item.to" target="_blank" rel="noopener" class="flex items-center gap-3 p-3 transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><UIcon :name="item.icon" class="size-4.5 shrink-0 text-muted" aria-hidden="true" />{{ t(item.labelKey) }}<UKbd v-if="item.shortcut" dir="ltr" class="ms-auto">{{ item.shortcut.toLocaleUpperCase() }}</UKbd></a>
          <NuxtLink v-else :to="item.to" class="flex items-center gap-3 p-3 transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><UIcon :name="item.icon" class="size-4.5 shrink-0 text-muted" aria-hidden="true" />{{ t(item.labelKey) }}<UKbd v-if="item.shortcut" dir="ltr" class="ms-auto">{{ item.shortcut.toLocaleUpperCase() }}</UKbd></NuxtLink>
        </template>
      </div>
      <UButton
        v-if="nav.length > NAV_LIMIT"
        type="button"
        color="neutral"
        variant="ghost"
        size="sm"
        class="justify-self-start"
        data-testid="search-nav-toggle"
        :aria-expanded="showAllNav"
        :label="showAllNav ? t('nav.goToShowLess') : t('nav.goToShowAll', { count: nav.length })"
        @click="showAllNav = !showAllNav"
      />
    </SharedRecordSection>
    <SharedRecordSection v-if="!query.trim() && actions.length" :title="t('app.actions')">
      <div class="flex flex-wrap gap-2"><UButton v-for="action in actions" :key="action.id" :to="{ path: action.to, query: { returnTo: route.fullPath } }" :icon="action.icon" color="neutral" variant="outline" :label="t(action.labelKey)" /></div>
    </SharedRecordSection>
    <SharedEmptyState v-if="noResults" :title="t('app.noResults')" />
  </SharedRecordPage>
</template>
