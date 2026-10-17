<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { invoiceStatusBadge } from '@webvue/commercial-ui/app/utils/commercialBadges'
import { formatSubscriptionMoney } from '@/utils/subscription'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t, locale } = useI18n(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities()
const allowed = computed(() => can('billing.read'))
const { data, error, pending, refresh } = await useAsyncData('subscription:invoices', () => api.invoices(), { immediate: allowed.value })
const items = computed(() => data.value?.items ?? [])
definePageMeta({ middleware: 'customer-commercial' })

const invoiceTo = (inv: (typeof items.value)[number]) => `/subscription/invoices/${encodeURIComponent(inv.id)}`

const columns = computed<TableColumn<(typeof items.value)[number]>[]>(() => [
  { id: 'number', header: t('subscription.invoices.number') },
  { id: 'period', header: t('subscription.invoices.period') },
  { id: 'status', header: t('subscription.invoices.status') },
  { id: 'total', header: t('subscription.invoices.total') },
])
</script>
<template>
<SharedListPage :title="t('subscription.invoices.title')" :description="t('subscription.invoices.description')" back-to="/subscription">

<SharedForbiddenState v-if="!allowed" />
<SharedListCard v-if="allowed">
<SharedDataTable bare :rows="items" :columns="columns" row-key="id" :row-to="invoiceTo" :loading="pending" :error="error" :empty-text="t('subscription.invoices.empty')" :caption="t('subscription.invoices.title')" @retry="refresh">
  <template #number-cell="{ row: { original: inv } }"><NuxtLink :to="invoiceTo(inv)" data-testid="invoice-row" class="font-medium hover:underline">{{ inv.number ?? inv.id }}</NuxtLink></template>
  <template #period-cell="{ row: { original: inv } }"><bdi dir="ltr">{{ inv.period_start }} → {{ inv.period_end }}</bdi></template>
  <template #status-cell="{ row: { original: inv } }"><SharedStatusBadge  :tone="invoiceStatusBadge(inv.status, 'subscription.invoices.statuses').tone" :label="invoiceStatusBadge(inv.status, 'subscription.invoices.statuses').labelKey ? t(invoiceStatusBadge(inv.status, 'subscription.invoices.statuses').labelKey) : inv.status" /></template>
  <template #total-cell="{ row: { original: inv } }"><bdi dir="ltr" class="font-semibold tabular-nums">{{ formatSubscriptionMoney(inv.total,locale) }}</bdi></template>
  <template #mobile-row="{ row: inv }"><NuxtLink data-testid="invoice-row" :to="`/subscription/invoices/${encodeURIComponent(inv.id)}`" class="font-medium">{{ inv.number ?? inv.id }}</NuxtLink>
          <span class="text-sm text-muted tabular-nums"><bdi dir="ltr">{{ inv.period_start }} → {{ inv.period_end }}</bdi></span>
          <SharedStatusBadge  :tone="invoiceStatusBadge(inv.status, 'subscription.invoices.statuses').tone" :label="invoiceStatusBadge(inv.status, 'subscription.invoices.statuses').labelKey ? t(invoiceStatusBadge(inv.status, 'subscription.invoices.statuses').labelKey) : inv.status" />
          <span class="font-semibold tabular-nums">{{ formatSubscriptionMoney(inv.total, locale) }}</span></template>
  <template #footer><SharedListFooter :count-label="t('subscription.invoices.count', { count: items.length }, items.length)" :page="1" :pages="1" /></template>
</SharedDataTable>
</SharedListCard>
</SharedListPage>
</template>
