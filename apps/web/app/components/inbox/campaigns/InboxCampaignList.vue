<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { InboxCampaign } from '@webvue/contracts'
import { formatDateTime } from '@webvue/ui/app/utils/formatDate'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { CAMPAIGN_STATE_TONE, CAMPAIGN_STATES, deliveredPercent } from '@/composables/inbox/inboxCampaignPresentation'
import {
  CAMPAIGN_PAGE_SIZE, campaignPageOffset, parseCampaignListRoute, serializeCampaignListRoute, type CampaignListRoute,
} from '@/composables/inbox/inboxCampaignRoute'
import { TEMPLATE_CATEGORY_TONE } from '@/composables/inbox/inboxTemplate'
import { useInboxCampaignChannels, useInboxCampaignList } from '@/composables/inbox/useInboxCampaigns'

// The campaigns of the company: filters (state, channel, search) and the page live in the address, so a direct link, a
// refresh and Back keep them. A row opens the campaign's own page; creating one is the route-backed panel at /new.
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()

const filters = computed(() => parseCampaignListRoute(route.query))
const list = useInboxCampaignList(filters)
const channels = useInboxCampaignChannels()
const items = computed(() => list.data.value?.items ?? [])
const total = computed(() => list.data.value?.total ?? 0)
const page = computed(() => Math.floor(filters.value.offset / CAMPAIGN_PAGE_SIZE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / CAMPAIGN_PAGE_SIZE)))
const showEmpty = computed(() => !list.isLoading.value && !list.error.value && !items.value.length)
const filtered = computed(() => !!(filters.value.state || filters.value.channelId || filters.value.q))
const activeCount = computed(() => [filters.value.state, filters.value.channelId, filters.value.q].filter(Boolean).length)

function setFilters(patch: Partial<CampaignListRoute>) {
  if (!hydrated.value) return
  const next = { ...filters.value, offset: 0, ...patch }
  void router.replace({ path: route.path, query: serializeCampaignListRoute(next) })
}
function setPage(next: number) {
  if (!hydrated.value || list.isFetching.value) return
  setFilters({ offset: campaignPageOffset(next, total.value) })
}

const ALL = 'all'
const stateItems = computed(() => [{ value: ALL, label: t('inbox.campaigns.filters.allStates') }, ...CAMPAIGN_STATES.map(value => ({ value, label: t(`inbox.campaigns.states.${value}`) }))])
const channelItems = computed(() => [{ value: ALL, label: t('inbox.campaigns.filters.allChannels') }, ...(channels.data.value?.items ?? []).map(item => ({ value: String(item.id), label: item.name }))])

const columns = computed<TableColumn<InboxCampaign>[]>(() => [
  { accessorKey: 'name', header: t('inbox.settings.name') },
  { accessorKey: 'state', header: t('inbox.campaigns.columns.state'), meta: { class: { th: 'w-[130px]', td: 'w-[130px]' } } },
  { accessorKey: 'channel', header: t('inbox.campaigns.columns.channel') },
  { accessorKey: 'template', header: t('inbox.campaigns.columns.template') },
  { accessorKey: 'audience', header: t('inbox.campaigns.columns.audience') },
  { accessorKey: 'stats', header: t('inbox.campaigns.columns.progress'), meta: { class: { th: 'w-[150px]', td: 'w-[150px]' } } },
  { accessorKey: 'launched_at', header: t('inbox.campaigns.columns.when'), meta: { class: { th: 'w-[160px]', td: 'w-[160px]' } } },
])
const whenOf = (campaign: InboxCampaign) => campaign.launched_at ?? campaign.scheduled_at ?? campaign.created_at
const rowTo = (campaign: InboxCampaign) => ({ path: `/inbox/campaigns/${campaign.id}`, query: returnToQuery(route.fullPath) })
const createTo = computed(() => ({ path: '/inbox/campaigns/new', query: route.query }))
</script>

<template>
  <SharedListCard data-testid="inbox-campaigns-card">
    <template #filters>
      <SharedFilterBar embedded class="w-full" :active-count="activeCount" :disabled="!hydrated" @clear="setFilters({ state: '', channelId: null, q: '' })">
        <template #search>
          <UInput
            :model-value="filters.q" class="min-w-48 flex-1" icon="i-lucide-search" :disabled="!hydrated"
            :aria-label="t('inbox.campaigns.filters.search')" :placeholder="t('inbox.campaigns.filters.search')" data-testid="inbox-campaigns-search"
            @update:model-value="setFilters({ q: String($event ?? '').trim() })"
          />
        </template>
        <SharedFilterField :label="t('inbox.campaigns.columns.state')">
          <USelect :model-value="filters.state || ALL" :items="stateItems" class="w-full" :disabled="!hydrated" data-testid="inbox-campaigns-state" @update:model-value="setFilters({ state: $event === ALL ? '' : ($event as CampaignListRoute['state']) })" />
        </SharedFilterField>
        <SharedFilterField :label="t('inbox.campaigns.columns.channel')">
          <USelect :model-value="filters.channelId ? String(filters.channelId) : ALL" :items="channelItems" class="w-full" :disabled="!hydrated" @update:model-value="setFilters({ channelId: $event === ALL ? null : Number($event) })" />
        </SharedFilterField>
      </SharedFilterBar>
    </template>

    <SharedPageState :error="list.error.value" :keep-content="items.length > 0" @retry="list.refetch">
      <SharedEmptyState
        v-if="showEmpty" class="m-(--webvue-card-pad-dense)"
        :title="filtered ? t('inbox.campaigns.emptyFiltered') : t('inbox.campaigns.empty')"
        :description="filtered ? undefined : t('inbox.campaigns.emptyHint')" data-testid="inbox-campaigns-empty"
      >
        <template v-if="!filtered" #action>
          <UButton :to="createTo" icon="i-lucide-plus" :disabled="!hydrated" :label="t('inbox.campaigns.new')" />
        </template>
      </SharedEmptyState>
      <SharedDataTable v-else bare :rows="items" :columns="columns" row-key="id" :row-to="rowTo" :loading="list.isLoading.value" :caption="t('inbox.campaigns.title')">
        <template #name-cell="{ row }"><span class="font-semibold text-highlighted" :data-testid="`inbox-campaign-row-${row.original.id}`">{{ row.original.name }}</span></template>
        <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="CAMPAIGN_STATE_TONE[row.original.state]" :label="t(`inbox.campaigns.states.${row.original.state}`)" /></template>
        <template #channel-cell="{ row }">{{ row.original.channel.name }}</template>
        <template #template-cell="{ row }">
          <span v-if="row.original.template" class="flex min-w-0 flex-wrap items-center gap-1.5">
            <bdi class="truncate" dir="ltr">{{ row.original.template.name }}</bdi>
            <SharedStatusBadge size="sm" :tone="TEMPLATE_CATEGORY_TONE[row.original.template.category]" :label="t(`inbox.templates.category.${row.original.template.category}`)" />
          </span>
          <span v-else class="text-muted">{{ t('inbox.campaigns.noTemplate') }}</span>
        </template>
        <template #audience-cell="{ row }">{{ row.original.audience.name }}</template>
        <template #stats-cell="{ row }">
          <div class="flex flex-col gap-1">
            <SharedProgress :value="deliveredPercent(row.original.stats)" tone="success" :label="t('inbox.campaigns.columns.progress')" />
            <span class="text-xs text-muted tabular-nums">{{ row.original.stats.delivered + row.original.stats.read }} / {{ row.original.stats.total - row.original.stats.skipped }}</span>
          </div>
        </template>
        <template #launched_at-cell="{ row }"><time class="text-sm" :datetime="whenOf(row.original)">{{ formatDateTime(whenOf(row.original)) }}</time></template>
        <template #mobile-row="{ row }">
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-highlighted">{{ row.name }}</span>
            <SharedStatusBadge size="sm" :tone="CAMPAIGN_STATE_TONE[row.state]" :label="t(`inbox.campaigns.states.${row.state}`)" />
          </div>
          <p class="mt-1 text-sm text-muted">{{ row.channel.name }} · {{ row.audience.name }}</p>
        </template>
      </SharedDataTable>
    </SharedPageState>
    <template v-if="list.data.value && !showEmpty" #footer>
      <SharedListFooter :count-label="t('inbox.campaigns.footer', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="list.isFetching.value" count-test-id="inbox-campaigns-count" @update:page="setPage" />
    </template>
  </SharedListCard>
</template>
