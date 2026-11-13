<script setup lang="ts">
import type { Customer } from '@liwan/contracts'
import { CUSTOMER_PAGE_SIZE, CUSTOMERS_LIST_PATH, customerListLocation, parseCustomerListQuery, safeCustomersReturnTo } from '@/composables/customers/customerListParams'
import { useCustomers } from '@/composables/customers/useCustomers'
import { useLastPageClamp, useRouteListFilters } from '@/composables/useRouteListFilters'
import CustomerTable from './CustomerTable.vue'

// The body of the customers page: the filter bar (search and the archived switch), then the table in one card with its
// pager. The filters live in the URL query, so a record and the browser's Back return to the same list. `background` is
// the list behind the create panel: it reads its filters from the panel's returnTo. The page owns the SharedListPage shell.
const props = defineProps<{ background?: boolean }>()
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const { hydrated, filterQuery, search, update } = useRouteListFilters({ background: () => props.background, fallbackPath: () => CUSTOMERS_LIST_PATH, safeReturnTo: safeCustomersReturnTo })

const state = computed(() => parseCustomerListQuery(filterQuery.value))
const query = useCustomers(state)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / CUSTOMER_PAGE_SIZE)))
useLastPageClamp({ page: () => state.value.page, total: () => query.data.value?.total, pageSize: CUSTOMER_PAGE_SIZE })
const activeCount = computed(() => Number(Boolean(state.value.q)))
const backTo = computed(() => customerListLocation(filterQuery.value, route.hash))
const recordTo = (customer: Customer) => ({ path: `${CUSTOMERS_LIST_PATH}/${customer.id}`, query: { returnTo: backTo.value } })

const scopes = computed(() => [
  { value: 'active', label: t('customers.status.active') },
  { value: 'archived', label: t('customers.status.archived') },
])
function setScope(value: string | number) { void update({ archived: value === 'archived' ? '1' : undefined, page: undefined }) }
function clearFilters() { search.value = ''; void update({ q: undefined, page: undefined }) }
const emptyText = computed(() => t(activeCount.value ? 'app.noResults' : state.value.archived ? 'customers.emptyArchived' : 'customers.empty'))
</script>

<template>
  <SharedForbiddenState v-if="!can('customers.read')" />
  <div v-else class="flex min-w-0 flex-col gap-4">
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })">
              <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('customers.search')" :aria-label="t('customers.search')" :disabled="!hydrated" data-testid="customers-search" />
            </form>
          </template>
          <template #view>
            <SharedSegmentedControl data-testid="customers-scope" :label="t('customers.columns.status')" :items="scopes" :model-value="state.archived ? 'archived' : 'active'" @update:model-value="setScope" />
          </template>
        </SharedFilterBar>
      </template>
      <SharedPageState v-if="query.error.value && !query.data.value" :error="query.error.value" @retry="query.refetch()" />
      <SharedEmptyState v-else-if="!query.isPending.value && !items.length" class="m-(--liwan-card-pad-dense)" :title="emptyText">
        <template v-if="activeCount" #action><UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('customers.clear')" @click="clearFilters" /></template>
      </SharedEmptyState>
      <CustomerTable v-else :rows="items" :loading="query.isPending.value" :error="null" :record-to="recordTo" @retry="query.refetch()" />
      <template v-if="query.data.value && items.length" #footer>
        <SharedListFooter :count-label="t('customers.footer', { shown: items.length, total }, total)" :page="state.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
      </template>
    </SharedListCard>
  </div>
</template>
