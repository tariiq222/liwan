<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { InboxOrder } from '@liwan/contracts'
import { orderBadge } from '@/composables/inbox/inboxCommerce'
import { inboxContactName } from '@/composables/inbox/inboxContactName'
import { useInboxCatalogEnabled } from '@/composables/inbox/useInboxCatalog'
import { useInboxOrderKpis } from '@/composables/inbox/useInboxKpis'
import { useInboxOrders } from '@/composables/inbox/useInboxOrders'
import { useInboxChannels } from '@/composables/inbox/useInboxSettings'
import { listPageNumber, useLastPageClamp } from '@/composables/useRouteListFilters'
import { formatCurrency } from '@/utils/formatCurrency'

// The orders across the conversations the viewer can see: carts customers sent and orders agents built, filtered by
// state, payment status and channel. The filters live in the address (`?state=&payment_status=&channel_id=&q=&page=`),
// so a filtered list survives refresh and back; a row opens its conversation's orders panel.
const PAGE_SIZE = 20
const ALL = 'all'
const STATES = ['cart', 'ordered', 'dismissed'] as const
const PAYMENTS = ['payable', 'processing', 'paid', 'not_payable', 'cancelled'] as const
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const enabled = useInboxCatalogEnabled()
const pick = (key: string, allowed: readonly string[]) => (typeof route.query[key] === 'string' && allowed.includes(route.query[key] as string) ? (route.query[key] as string) : '')
const channels = useInboxChannels()
const state = computed(() => pick('state', STATES))
const payment = computed(() => pick('payment_status', PAYMENTS))
const channelId = computed(() => (channels.data.value?.items.some(item => String(item.id) === route.query.channel_id) ? Number(route.query.channel_id) : undefined))
const committedSearch = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))
const search = ref(committedSearch.value)
watch(committedSearch, (value) => { search.value = value })
const page = computed(() => listPageNumber(route.query.page))
const query = useInboxOrders(() => ({ state: state.value, payment_status: payment.value, channel_id: channelId.value, q: committedSearch.value.trim(), limit: PAGE_SIZE, offset: (page.value - 1) * PAGE_SIZE }), enabled)
// The summary strip counts the whole list under the search and the channel; each tile adds its own state or payment.
const { shown: kpisShown } = useKpiVisibility()
const kpis = useInboxOrderKpis(
  () => ({ q: committedSearch.value.trim(), channelId: channelId.value }),
  computed(() => hydrated.value && kpisShown.value && enabled.value),
)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
useLastPageClamp({ page: () => page.value, total: () => query.data.value?.total, pageSize: PAGE_SIZE })
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const filtered = computed(() => !!(state.value || payment.value || channelId.value || committedSearch.value.trim()))

const day = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }))
const columns = computed<TableColumn<InboxOrder>[]>(() => [
  { id: 'order', header: t('inbox.orders.columns.order'), meta: { title: true, class: { th: 'min-w-48 w-[26%]', td: 'max-w-0' } } },
  { id: 'customer', header: t('inbox.orders.columns.customer'), meta: { class: { th: 'min-w-40 w-[24%]', td: 'max-w-0' } } },
  { id: 'channel', header: t('inbox.orders.filter.channel'), meta: { class: { th: 'w-40', td: 'w-40 max-w-0' } } },
  { id: 'date', header: t('inbox.orders.columns.date'), meta: { class: { th: 'w-48', td: 'w-48 whitespace-nowrap' } } },
  { id: 'total', header: t('inbox.orders.total'), meta: { class: { th: 'w-36 text-end', td: 'w-36 whitespace-nowrap text-end' } } },
  { id: 'state', header: t('inbox.orders.filter.state'), meta: { class: { th: 'w-36', td: 'w-36 whitespace-nowrap' } } },
])
const orderTo = (order: InboxOrder) => `/inbox/${order.conversation_id}/orders`
const badge = (order: InboxOrder) => {
  const { tone, labelKey } = orderBadge({ state: order.state, payment_status: order.payment?.status ?? null })
  return { tone, label: t(labelKey) }
}

function update(values: Record<string, string | undefined>) {
  if (!hydrated.value) return
  void router.replace({ path: route.path, query: { ...route.query, page: undefined, ...values } })
}
const withAll = (values: readonly string[], key: string, labelKey: string) => [{ value: ALL, label: t(`inbox.orders.filter.any.${key}`) }, ...values.map(value => ({ value, label: t(`${labelKey}.${value}`) }))]
const stateItems = computed(() => withAll(STATES, 'state', 'inbox.orders.state'))
const paymentItems = computed(() => withAll(PAYMENTS, 'payment', 'inbox.orders.payment'))
const channelItems = computed(() => [{ value: ALL, label: t('inbox.orders.filter.any.channel') }, ...(channels.data.value?.items ?? []).map(item => ({ value: String(item.id), label: item.name }))])
function clear() {
  search.value = ''
  update({ state: undefined, payment_status: undefined, channel_id: undefined, q: undefined })
}
</script>

<template>
  <SharedForbiddenState v-if="!enabled" />
  <SharedListPage v-else :title="t('inbox.orders.title')" back-to="/inbox" :back-label="t('inbox.title')" data-testid="inbox-orders-page">
    <template #kpis>
      <SharedKpiStrip v-if="hydrated && kpisShown" :tiles="kpis.tiles.value" :loading="kpis.loading.value" :label="t('inbox.orders.kpi.label')" data-testid="inbox-orders-kpi-strip" />
    </template>
    <SharedListCard data-testid="inbox-orders-list">
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="Number(!!state) + Number(!!payment) + Number(!!channelId) + Number(!!committedSearch.trim())" :disabled="!hydrated" @clear="clear">
          <template #search>
            <form @submit.prevent="update({ q: search.trim() || undefined })">
              <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('inbox.orders.filter.search')" :aria-label="t('inbox.orders.filter.search')" :disabled="!hydrated" data-testid="inbox-orders-search" @blur="update({ q: search.trim() || undefined })" />
            </form>
          </template>
          <USelect :model-value="state || ALL" :items="stateItems" :aria-label="t('inbox.orders.filter.state')" :disabled="!hydrated" data-testid="inbox-orders-filter-state" @update:model-value="update({ state: $event === ALL ? undefined : $event })" />
          <USelect :model-value="payment || ALL" :items="paymentItems" :aria-label="t('inbox.orders.filter.payment')" :disabled="!hydrated" data-testid="inbox-orders-filter-payment" @update:model-value="update({ payment_status: $event === ALL ? undefined : $event })" />
          <USelect :model-value="channelId ? String(channelId) : ALL" :items="channelItems" :aria-label="t('inbox.orders.filter.channel')" :disabled="!hydrated" @update:model-value="update({ channel_id: $event === ALL ? undefined : $event })" />
        </SharedFilterBar>
      </template>
      <SharedDataTable
        bare
        :rows="items"
        :columns="columns"
        row-key="id"
        :row-to="orderTo"
        :loading="query.isPending.value"
        :error="query.error.value"
        :empty-icon="filtered ? 'i-lucide-filter-x' : 'i-lucide-shopping-cart'"
        :empty-text="filtered ? t('app.noResults') : t('inbox.orders.empty')"
        :caption="t('inbox.orders.title')"
        data-testid="inbox-orders-table"
        @retry="query.refetch()"
      >
        <template #order-cell="{ row }">
          <NuxtLink :to="orderTo(row.original)" class="block min-w-0 truncate font-semibold text-highlighted" :title="row.original.reference ?? t('inbox.orders.cartTitle')" :data-testid="`inbox-orders-row-${row.original.id}`">
            <bdi v-if="row.original.reference" dir="ltr">{{ row.original.reference }}</bdi><template v-else>{{ t('inbox.orders.cartTitle') }}</template>
          </NuxtLink>
        </template>
        <template #customer-cell="{ row }">
          <span class="block truncate" :title="inboxContactName(row.original.contact, t)">{{ inboxContactName(row.original.contact, t) }}</span>
        </template>
        <template #channel-cell="{ row }">
          <span class="block truncate text-muted" :title="row.original.channel.name">{{ row.original.channel.name }}</span>
        </template>
        <template #date-cell="{ row }">
          <time class="tabular-nums" :datetime="row.original.created_at">{{ day.format(new Date(row.original.created_at)) }}</time>
        </template>
        <template #total-cell="{ row }">
          <span class="tabular-nums">{{ formatCurrency(row.original.total, row.original.currency, locale) }}</span>
        </template>
        <template #state-cell="{ row }">
          <SharedStatusBadge size="sm" v-bind="badge(row.original)" />
        </template>
        <template #mobile-row="{ row }">
          <NuxtLink :to="orderTo(row)" class="grid min-w-0 gap-2 focus-visible:outline-none">
            <div class="flex min-w-0 items-start justify-between gap-2">
              <span class="min-w-0 break-words font-semibold text-highlighted"><bdi v-if="row.reference" dir="ltr">{{ row.reference }}</bdi><template v-else>{{ t('inbox.orders.cartTitle') }}</template></span>
              <SharedStatusBadge size="sm" v-bind="badge(row)" class="shrink-0" />
            </div>
            <div class="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-muted">
              <span class="min-w-0 truncate">{{ inboxContactName(row.contact, t) }} · {{ row.channel.name }} · {{ t('inbox.orders.lineCount', { n: row.lines.length }) }} · <time :datetime="row.created_at">{{ day.format(new Date(row.created_at)) }}</time></span>
              <span class="font-semibold tabular-nums text-default">{{ formatCurrency(row.total, row.currency, locale) }}</span>
            </div>
          </NuxtLink>
        </template>
      </SharedDataTable>

      <template v-if="!query.error.value && items.length" #footer>
        <SharedListFooter
          :count-label="t('inbox.orders.footer', { shown: items.length, total }, total)"
          count-test-id="inbox-orders-result-count"
          :page="page"
          :pages="pages"
          :disabled="query.isFetching.value || !hydrated"
          @update:page="update({ page: $event > 1 ? String($event) : undefined })"
        />
      </template>
    </SharedListCard>
  </SharedListPage>
</template>
