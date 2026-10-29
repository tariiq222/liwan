<script setup lang="ts">
import InboxOrdersTable from '@/components/inbox/InboxOrdersTable.vue'
import { useInboxCatalogEnabled } from '@/composables/inbox/useInboxCatalog'
import { useInboxOrders } from '@/composables/inbox/useInboxOrders'
import { useInboxChannels } from '@/composables/inbox/useInboxSettings'
import { listPageNumber } from '@/composables/useRouteListFilters'

// The orders across the conversations the viewer can see: carts customers sent and orders agents built, filtered by
// state, payment status and channel. The filters live in the address (`?state=&payment_status=&channel_id=&q=&page=`),
// so a filtered list survives refresh and back; a row opens its conversation's orders panel.
const PAGE_SIZE = 20
const ALL = 'all'
const STATES = ['cart', 'ordered', 'dismissed'] as const
const PAYMENTS = ['payable', 'processing', 'paid', 'not_payable', 'cancelled'] as const
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
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
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const filtered = computed(() => !!(state.value || payment.value || channelId.value || committedSearch.value.trim()))

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
  <SharedPageContainer v-else width="list">
    <!-- Not sticky: the inbox shell's content area has no floating-header slot, so a sticky header would cover the filters. -->
    <SharedPageHeader :title="t('inbox.orders.title')" back-to="/inbox" :back-label="t('inbox.title')" :sticky="false" />
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
      <SharedLoadingSkeleton v-if="query.isPending.value" class="m-4" />
      <SharedPageState v-else-if="query.error.value" class="m-4" :error="query.error.value" @retry="query.refetch()" />
      <SharedEmptyState v-else-if="!items.length" class="m-(--webvue-card-pad-dense)" :title="filtered ? t('app.noResults') : t('inbox.orders.empty')" :description="filtered ? undefined : t('inbox.orders.emptyDescription')" />
      <InboxOrdersTable v-else :orders="items" />
      <template v-if="pages > 1" #footer>
        <SharedPagination :page="page" :pages="pages" class="w-full" @update:page="update({ page: $event > 1 ? String($event) : undefined })" />
      </template>
    </SharedListCard>
  </SharedPageContainer>
</template>
