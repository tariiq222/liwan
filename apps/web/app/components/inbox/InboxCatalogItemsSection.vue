<script setup lang="ts">
import InboxCatalogItemTable from '@/components/inbox/InboxCatalogItemTable.vue'
import { useInboxCatalogItems } from '@/composables/inbox/useInboxCatalog'
import { listPageNumber } from '@/composables/useRouteListFilters'

// The items of one catalog with a name search and a sync-status filter kept in the address (`?q=&sync_state=&page=`),
// so a filtered list survives refresh and back. The add button opens the route-backed create panel.
const props = defineProps<{ catalogId: number; manage: boolean }>()
const PAGE_SIZE = 20
const ALL = 'all'
const SYNC_STATES = ['pending', 'syncing', 'synced', 'error', 'removing'] as const
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const syncState = computed(() => (SYNC_STATES as readonly string[]).includes(route.query.sync_state as string) ? (route.query.sync_state as string) : '')
const committedSearch = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))
const search = ref(committedSearch.value)
watch(committedSearch, (value) => { search.value = value })
const page = computed(() => listPageNumber(route.query.page))
const query = useInboxCatalogItems(() => props.catalogId, () => ({ q: committedSearch.value.trim(), sync_state: syncState.value, limit: PAGE_SIZE, offset: (page.value - 1) * PAGE_SIZE }))
const items = computed(() => query.data.value?.items ?? [])
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / PAGE_SIZE)))
const filtered = computed(() => !!(syncState.value || committedSearch.value.trim()))
const stateItems = computed(() => [{ value: ALL, label: t('inbox.catalog.items.anyState') }, ...SYNC_STATES.map(value => ({ value, label: t(`inbox.catalog.sync.${value}`) }))])

function update(values: Record<string, string | undefined>) {
  if (!hydrated.value) return
  void router.replace({ path: route.path, query: { ...route.query, page: undefined, ...values } })
}
function clear() {
  search.value = ''
  update({ q: undefined, sync_state: undefined })
}
</script>

<template>
  <SharedRecordSection id="items" variant="list" :title="t('inbox.catalog.items.title')" :description="t('inbox.catalog.items.hint')">
    <template v-if="props.manage" #actions>
      <UButton :to="{ path: `/settings/apps/inbox/catalog/${props.catalogId}/items/new`, query: route.query }" icon="i-lucide-plus" :disabled="!hydrated" :label="t('inbox.catalog.items.add')" data-testid="inbox-catalog-item-add" />
    </template>
    <div class="px-(--webvue-card-pad) py-3">
      <SharedFilterBar embedded class="w-full" :active-count="Number(!!syncState) + Number(!!committedSearch.trim())" :disabled="!hydrated" @clear="clear">
        <template #search>
          <form @submit.prevent="update({ q: search.trim() || undefined })">
            <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('inbox.catalog.items.search')" :aria-label="t('inbox.catalog.items.search')" :disabled="!hydrated" data-testid="inbox-catalog-item-search" @blur="update({ q: search.trim() || undefined })" />
          </form>
        </template>
        <USelect :model-value="syncState || ALL" :items="stateItems" :aria-label="t('inbox.catalog.items.syncFilter')" :disabled="!hydrated" data-testid="inbox-catalog-item-filter-sync" @update:model-value="update({ sync_state: $event === ALL ? undefined : $event })" />
      </SharedFilterBar>
    </div>
    <SharedLoadingSkeleton v-if="query.isPending.value" class="m-4" />
    <SharedPageState v-else-if="query.error.value" class="m-4" :error="query.error.value" @retry="query.refetch()" />
    <p v-else-if="!items.length" class="px-(--webvue-card-pad) py-4 text-sm text-muted" data-testid="inbox-catalog-items-empty">{{ filtered ? t('app.noResults') : t('inbox.catalog.items.empty') }}</p>
    <InboxCatalogItemTable v-else :items="items" :manage="props.manage" />
    <div v-if="pages > 1" class="px-(--webvue-card-pad) py-3"><SharedPagination :page="page" :pages="pages" @update:page="update({ page: $event > 1 ? String($event) : undefined })" /></div>
  </SharedRecordSection>
</template>
