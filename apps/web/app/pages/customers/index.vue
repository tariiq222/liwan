<script setup lang="ts">
import CustomerDirectory from '@/components/customers/CustomerDirectory.vue'
import { CUSTOMER_LIST_KEYS, CUSTOMERS_LIST_PATH, parseCustomerListQuery } from '@/composables/customers/customerListParams'
import { useCustomerKpis } from '@/composables/customers/useCustomerKpis'
import { listLocation } from '@/composables/useRouteListFilters'
import { useCustomersExport } from '@/composables/customers/useCustomersExport'
import { exportTooLargeMessage } from '@/utils/exportErrors'

const { t, n } = useI18n()
const route = useRoute()
const { can } = useAccess()
const toast = useToast()
const hydrated = useHydrated()
const { shown: kpisShown } = useKpiVisibility()
const canRead = computed(() => can('customers.read'))
const canExport = computed(() => can('customers.export'))
const exportCsv = useCustomersExport()
const listTotal = ref<number | undefined>(undefined)
const listState = computed(() => parseCustomerListQuery(route.query))
const kpis = useCustomerKpis(listState, listTotal, computed(() => kpisShown.value && canRead.value))
// The create link carries the list's state as its returnTo, so closing the panel returns to the same list.
const createTo = computed(() => can('customers.manage')
  ? { path: '/customers/new', query: { returnTo: listLocation(CUSTOMERS_LIST_PATH, CUSTOMER_LIST_KEYS, route.query, route.hash) } }
  : undefined)
function downloadCsv() {
  // The snapshot of the address is what the list shows now; the download reads nothing else.
  exportCsv.mutate(parseCustomerListQuery(route.query), { onError: error => toast.add({ title: exportTooLargeMessage(error, t, n) ?? t('customers.exportFailed'), color: 'error' }) })
}
</script>

<template>
  <SharedListPage :title="t('customers.title')" :create-to="createTo" :create-label="t('customers.new')" create-test-id="customer-new">
    <template v-if="canRead" #kpis>
      <SharedKpiStrip v-if="hydrated" :tiles="kpis.tiles.value" :loading="kpis.loading.value" :label="t('customers.kpi.label')" data-testid="customers-kpi-strip" />
    </template>
    <template #actions>
      <UButton
        v-if="canExport"
        variant="outline"
        icon="i-lucide-download"
        :loading="exportCsv.isPending.value"
        :disabled="!hydrated || exportCsv.isPending.value"
        data-testid="customers-export"
        @click="downloadCsv"
      >{{ t(exportCsv.isPending.value ? 'customers.exporting' : 'customers.export') }}</UButton>
    </template>
    <CustomerDirectory @update:total="listTotal = $event" />
  </SharedListPage>
</template>
