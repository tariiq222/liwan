<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { invoiceStatusBadge } from '@liwan/commercial-ui/app/utils/commercialBadges'
import { formatSubscriptionMoney } from '@/utils/subscription'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t, locale } = useI18n(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities()
const allowed = computed(() => can('billing.read'))
const { data, error, pending, refresh } = await useAsyncData('subscription:invoices', () => api.invoices(), { immediate: allowed.value })
const items = computed(() => data.value?.items ?? [])
definePageMeta({ middleware: 'customer-commercial' })

const invoiceTo = (inv: (typeof items.value)[number]) => `/subscription/invoices/${encodeURIComponent(inv.id)}`
const printTo = (inv: (typeof items.value)[number]) => `/subscription/invoices/print/${encodeURIComponent(inv.id)}`
const printLabel = (inv: (typeof items.value)[number]) => t('subscription.invoices.print.rowAction', { number: inv.number ?? inv.id })

const columns = computed<TableColumn<(typeof items.value)[number]>[]>(() => [
  { id: 'number', header: t('commercial.invoice.number'), meta: { title: true, class: { th: 'min-w-40', td: 'max-w-0' } } },
  { id: 'period', header: t('commercial.invoice.period'), meta: { class: { th: 'w-52', td: 'w-52 whitespace-nowrap' } } },
  { id: 'status', header: t('commercial.invoice.status'), meta: { class: { th: 'w-32', td: 'w-32 whitespace-nowrap' } } },
  { id: 'total', header: t('commercial.invoice.total'), meta: { class: { th: 'w-36', td: 'w-36 whitespace-nowrap' } } },
  { id: 'download', header: t('subscription.invoices.print.download'), meta: { class: { th: 'w-20 text-end', td: 'w-20 whitespace-nowrap text-end' } } },
])
</script>
<template>
<SharedListPage :title="t('subscription.invoices.title')" back-to="/subscription">

<SharedForbiddenState v-if="!allowed" />
<SharedListCard v-if="allowed">
<SharedDataTable bare :rows="items" :columns="columns" row-key="id" :row-to="invoiceTo" :loading="pending" :error="error" :empty-text="t('subscription.invoices.empty')" :caption="t('subscription.invoices.title')" @retry="refresh">
  <template #number-cell="{ row: { original: inv } }"><NuxtLink :to="invoiceTo(inv)" data-testid="invoice-row" class="block min-w-0 truncate font-medium hover:underline">{{ inv.number ?? inv.id }}</NuxtLink></template>
  <template #period-cell="{ row: { original: inv } }"><bdi dir="ltr">{{ inv.period_start }} → {{ inv.period_end }}</bdi></template>
  <template #status-cell="{ row: { original: inv } }"><SharedStatusBadge  :tone="invoiceStatusBadge(inv.status, 'commercial.invoice.statuses').tone" :label="invoiceStatusBadge(inv.status, 'commercial.invoice.statuses').labelKey ? t(invoiceStatusBadge(inv.status, 'commercial.invoice.statuses').labelKey) : inv.status" /></template>
  <template #total-cell="{ row: { original: inv } }"><bdi dir="ltr" class="font-semibold tabular-nums">{{ formatSubscriptionMoney(inv.total,locale) }}</bdi></template>
  <template #download-cell="{ row: { original: inv } }"><UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-file-down" :to="printTo(inv)" :aria-label="printLabel(inv)" data-testid="invoice-row-download" @click.stop /></template>
  <template #mobile-row="{ row: inv }"><NuxtLink data-testid="invoice-row" :to="`/subscription/invoices/${encodeURIComponent(inv.id)}`" class="font-medium">{{ inv.number ?? inv.id }}</NuxtLink>
          <span class="text-sm text-muted tabular-nums"><bdi dir="ltr">{{ inv.period_start }} → {{ inv.period_end }}</bdi></span>
          <SharedStatusBadge  :tone="invoiceStatusBadge(inv.status, 'commercial.invoice.statuses').tone" :label="invoiceStatusBadge(inv.status, 'commercial.invoice.statuses').labelKey ? t(invoiceStatusBadge(inv.status, 'commercial.invoice.statuses').labelKey) : inv.status" />
          <span class="font-semibold tabular-nums">{{ formatSubscriptionMoney(inv.total, locale) }}</span>
          <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-file-down" :to="printTo(inv)" :aria-label="printLabel(inv)" data-testid="invoice-row-download" @click.stop /></template>
  <template #footer><SharedListFooter :count-label="t('subscription.invoices.count', { count: items.length }, items.length)" :page="1" :pages="1" /></template>
</SharedDataTable>
</SharedListCard>
</SharedListPage>
</template>
