<script setup lang="ts">
import type { Invoice } from '@nasq/commercial-contracts'
import { formatVendorMoney } from '@/utils/vendorCommercial'
import { lineQuantities } from '@/utils/vendorSubscriptions'
const props = defineProps<{ lines: Invoice['lines'] }>()
const { t, locale } = useI18n()
const money = (m: Invoice['total']) => formatVendorMoney(m, locale.value)
const rows = computed(() => props.lines.map(l => ({ l, q: lineQuantities(l) })))
</script>
<template>
  <div class="overflow-x-auto" data-slot="invoice-lines">
    <table class="w-full text-sm">
      <thead class="text-start text-muted"><tr>
        <th class="py-2 pe-3 text-start font-medium">{{ t('vendor.invoices.line.description') }}</th>
        <th class="px-3 py-2 text-start font-medium">{{ t('vendor.invoices.line.free') }}</th>
        <th class="px-3 py-2 text-start font-medium">{{ t('vendor.invoices.line.paid') }}</th>
        <th class="px-3 py-2 text-start font-medium">{{ t('vendor.invoices.line.unit') }}</th>
        <th class="px-3 py-2 text-start font-medium">{{ t('vendor.invoices.line.period') }}</th>
        <th class="ps-3 py-2 text-start font-medium">{{ t('vendor.invoices.line.amount') }}</th>
      </tr></thead>
      <tbody class="divide-y divide-default">
        <tr v-for="{ l, q } in rows" :key="l.key" data-testid="invoice-line">
          <td class="py-2 pe-3">{{ l.description }} <UBadge color="neutral" variant="subtle" size="sm">{{ t(`vendor.invoices.lineKind.${l.kind}`) }}</UBadge></td>
          <td class="px-3 py-2 tabular-nums">{{ q.free ?? t('app.notAvailable') }}</td>
          <td class="px-3 py-2 tabular-nums">{{ q.paid }}</td>
          <td class="px-3 py-2 tabular-nums">{{ money(l.unit_amount) }}</td>
          <td class="px-3 py-2 tabular-nums"><bdi dir="ltr">{{ l.period_start }} → {{ l.period_end }}</bdi></td>
          <td class="ps-3 py-2 font-medium tabular-nums">{{ money(l.amount) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
