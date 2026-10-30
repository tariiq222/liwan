<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { InboxAudience } from '@liwan/contracts'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import InboxContactImport from '@/components/inbox/campaigns/InboxContactImport.vue'
import { CAMPAIGN_PAGE_SIZE, campaignPageOffset, parseAudienceListRoute, serializeAudienceListRoute, type AudienceListRoute } from '@/composables/inbox/inboxCampaignRoute'
import { useInboxAudienceList } from '@/composables/inbox/useInboxCampaigns'

// The saved audiences with their live counts, and below them the contact CSV import. Creating an audience is the
// route-backed panel at /new over this page; a row opens the audience's own page.
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const filters = computed(() => parseAudienceListRoute(route.query))
const list = useInboxAudienceList(filters)
const items = computed(() => list.data.value?.items ?? [])
const total = computed(() => list.data.value?.total ?? 0)
const page = computed(() => Math.floor(filters.value.offset / CAMPAIGN_PAGE_SIZE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / CAMPAIGN_PAGE_SIZE)))
const showEmpty = computed(() => !list.isLoading.value && !list.error.value && !items.value.length)

function setFilters(patch: Partial<AudienceListRoute>) {
  if (hydrated.value) void router.replace({ path: route.path, query: serializeAudienceListRoute({ ...filters.value, offset: 0, ...patch }) })
}
function setPage(next: number) {
  if (hydrated.value && !list.isFetching.value) setFilters({ offset: campaignPageOffset(next, total.value) })
}
const columns = computed<TableColumn<InboxAudience>[]>(() => [
  { accessorKey: 'name', header: t('inbox.settings.name') },
  { accessorKey: 'tags', header: t('inbox.panel.tags') },
  { accessorKey: 'contact_count', header: t('inbox.campaigns.audiences.contacts'), meta: { class: { th: 'w-[110px]', td: 'w-[110px]' } } },
  { accessorKey: 'reachable_count', header: t('inbox.campaigns.audiences.reachable'), meta: { class: { th: 'w-[110px]', td: 'w-[110px]' } } },
])
const rowTo = (audience: InboxAudience) => ({ path: `/inbox/campaigns/audiences/${audience.id}`, query: returnToQuery(route.fullPath) })
</script>

<template>
  <SharedListCard>
    <template #filters>
      <SharedFilterBar embedded class="w-full" :active-count="filters.q ? 1 : 0" :disabled="!hydrated" @clear="setFilters({ q: '' })">
        <template #search>
          <UInput
            :model-value="filters.q" class="min-w-48 flex-1" icon="i-lucide-search" :disabled="!hydrated"
            :aria-label="t('inbox.campaigns.audiences.search')" :placeholder="t('inbox.campaigns.audiences.search')" data-testid="inbox-audiences-search"
            @update:model-value="setFilters({ q: String($event ?? '').trim() })"
          />
        </template>
      </SharedFilterBar>
    </template>
    <SharedPageState :error="list.error.value" :keep-content="items.length > 0" @retry="list.refetch">
      <SharedEmptyState v-if="showEmpty" class="m-(--liwan-card-pad-dense)" :title="t('inbox.campaigns.audiences.empty')" :description="t('inbox.campaigns.audiences.emptyHint')" data-testid="inbox-audiences-empty" />
      <SharedDataTable v-else bare :rows="items" :columns="columns" row-key="id" :row-to="rowTo" :loading="list.isLoading.value" :caption="t('inbox.campaigns.audiences.title')">
        <template #name-cell="{ row }"><span class="font-semibold text-highlighted" :data-testid="`inbox-audience-row-${row.original.id}`">{{ row.original.name }}</span></template>
        <template #tags-cell="{ row }">
          <span v-if="row.original.tags.length" class="flex flex-wrap gap-1"><SharedStatusBadge v-for="tag in row.original.tags" :key="tag.id" size="sm" tone="neutral" :label="tag.name" /></span>
          <span v-else class="text-muted">{{ t('inbox.campaigns.audiences.everyone') }}</span>
        </template>
        <template #contact_count-cell="{ row }"><span class="tabular-nums">{{ row.original.contact_count }}</span></template>
        <template #reachable_count-cell="{ row }"><span class="tabular-nums">{{ row.original.reachable_count }}</span></template>
        <template #mobile-row="{ row }">
          <p class="font-semibold text-highlighted">{{ row.name }}</p>
          <p class="mt-1 text-sm text-muted">{{ t('inbox.campaigns.audiences.reachableOf', { reachable: row.reachable_count, total: row.contact_count }) }}</p>
        </template>
      </SharedDataTable>
    </SharedPageState>
    <template v-if="list.data.value && !showEmpty" #footer>
      <SharedListFooter :count-label="t('inbox.campaigns.audiences.footer', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="list.isFetching.value" count-test-id="inbox-audiences-count" @update:page="setPage" />
    </template>
  </SharedListCard>
  <InboxContactImport />
</template>
