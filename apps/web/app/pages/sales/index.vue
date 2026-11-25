<script setup lang="ts">
import SalesOrderDirectory from '@/components/sales/SalesOrderDirectory.vue'
import { SALES_LIST_KEYS, SALES_LIST_PATH, parseSalesListQuery } from '@/composables/sales/salesListParams'
import { useSalesListKpis } from '@/composables/sales/useSalesKpis'
import { listLocation } from '@/composables/useRouteListFilters'

const { t } = useI18n()
const route = useRoute()
const { can } = useAccess()
const hydrated = useHydrated()
const { shown: kpisShown } = useKpiVisibility()
const canRead = computed(() => can('sales.read'))
const listTotal = ref<number | undefined>(undefined)
const listState = computed(() => parseSalesListQuery(route.query))
const kpis = useSalesListKpis(listState, listTotal, computed(() => kpisShown.value && canRead.value))
// The create link carries the list's state as its returnTo, so closing the panel returns to the same list.
const createTo = computed(() => can('sales.quotations.manage')
  ? { path: '/sales/new', query: { returnTo: listLocation(SALES_LIST_PATH, SALES_LIST_KEYS, route.query, route.hash) } }
  : undefined)
</script>

<template>
  <SharedListPage :title="t('sales.title')" :create-to="createTo" :create-label="t('sales.new')" create-test-id="sales-new">
    <template v-if="canRead" #kpis>
      <SharedKpiStrip v-if="hydrated" :tiles="kpis.tiles.value" :loading="kpis.loading.value" :label="t('sales.kpi.label')" data-testid="sales-kpi-strip" />
    </template>
    <SalesOrderDirectory @update:total="listTotal = $event" />
  </SharedListPage>
</template>
