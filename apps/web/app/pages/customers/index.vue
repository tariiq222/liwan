<script setup lang="ts">
import CustomerDirectory from '@/components/customers/CustomerDirectory.vue'
import { customerListLocation, parseCustomerListQuery } from '@/composables/customers/customerListParams'
import { useCustomersExport } from '@/composables/customers/useCustomersExport'

const { t } = useI18n()
const route = useRoute()
const { can } = useAccess()
const toast = useToast()
const hydrated = useHydrated()
const canExport = computed(() => can('customers.export'))
const exportCsv = useCustomersExport()
// The create link carries the list's state as its returnTo, so closing the panel returns to the same list.
const createTo = computed(() => can('customers.manage')
  ? { path: '/customers/new', query: { returnTo: customerListLocation(route.query, route.hash) } }
  : undefined)
function downloadCsv() {
  // The snapshot of the address is what the list shows now; the download reads nothing else.
  exportCsv.mutate(parseCustomerListQuery(route.query), { onError: () => toast.add({ title: t('customers.exportFailed'), color: 'error' }) })
}
</script>

<template>
  <SharedListPage :title="t('customers.title')" :create-to="createTo" :create-label="t('customers.new')" create-test-id="customer-new">
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
    <CustomerDirectory />
  </SharedListPage>
</template>
