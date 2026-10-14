<script setup lang="ts">
import type { InvoiceLineView } from '@/utils/invoiceLines'

// Invoice lines for the customer and the vendor (Tasmim spec §6 merge). The caller
// translates every label and formats every amount; this draws a table or a list.
const props = withDefaults(defineProps<{
  lines: InvoiceLineView[]
  totals?: { label: string; value: string }[]
  notice?: string
  layout?: 'table' | 'list'
}>(), { layout: 'table' })
const { t } = useI18n()
// Table columns come from the first line, so every line must carry the same cell keys.
const columns = computed(() => props.lines[0]?.cells.map(cell => ({ key: cell.key, label: cell.label })) ?? [])
// Only numbers, money and periods are isolated left-to-right; a text placeholder is not.
const isolated = (value: string) => /\d/.test(value)
</script>

<template>
  <div class="space-y-4" data-slot="invoice-lines">
    <p v-if="props.notice" class="border-s-2 border-warning ps-2 text-sm font-medium text-default" data-testid="not-official">{{ props.notice }}</p>
    <div v-if="props.layout === 'table'" class="overflow-x-auto">
      <table class="w-full text-sm">
        <caption class="sr-only">{{ t('states.invoice.lines') }}</caption>
        <thead class="text-muted">
          <tr>
            <th scope="col" class="py-2 pe-3 text-start font-medium">{{ t('states.invoice.description') }}</th>
            <th v-for="column in columns" :key="column.key" scope="col" class="px-3 py-2 text-start font-medium">{{ column.label }}</th>
            <th scope="col" class="ps-3 py-2 text-start font-medium">{{ t('states.invoice.amount') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr v-for="line in props.lines" :key="line.id" data-testid="invoice-line">
            <td class="py-2 pe-3">{{ line.description }} <SharedStatusBadge v-if="line.kind" :tone="line.kind.tone" :label="line.kind.label" size="sm" /></td>
            <td v-for="cell in line.cells" :key="cell.key" class="px-3 py-2 tabular-nums"><bdi v-if="isolated(cell.value)" dir="ltr">{{ cell.value }}</bdi><template v-else>{{ cell.value }}</template></td>
            <td class="ps-3 py-2 font-medium tabular-nums"><bdi dir="ltr">{{ line.amount }}</bdi></td>
          </tr>
        </tbody>
      </table>
    </div>
    <ul v-else class="divide-y divide-default rounded-lg ring ring-default" :aria-label="t('states.invoice.lines')">
      <li v-for="line in props.lines" :key="line.id" class="flex items-center justify-between gap-3 p-3" data-testid="invoice-line">
        <span class="min-w-0">
          {{ line.description }}
          <SharedStatusBadge v-if="line.kind" class="ms-2" :tone="line.kind.tone" :label="line.kind.label" size="sm" />
          <span v-if="line.cells.length" class="ms-2 text-xs text-muted tabular-nums">
            <template v-for="(cell, index) in line.cells" :key="cell.key"><template v-if="index"> · </template><bdi v-if="isolated(cell.value)" dir="ltr">{{ cell.value }}</bdi><template v-else>{{ cell.value }}</template><template v-if="cell.label">{{ " " + cell.label }}</template></template>
          </span>
        </span>
        <span class="font-medium tabular-nums"><bdi dir="ltr">{{ line.amount }}</bdi></span>
      </li>
    </ul>
    <dl v-if="props.totals?.length" class="space-y-2 rounded-lg bg-elevated p-3" :aria-label="t('states.invoice.totals')">
      <div v-for="(row, index) in props.totals" :key="row.label" class="flex justify-between gap-3">
        <dt :class="index === props.totals.length - 1 ? 'font-semibold' : 'text-toned'">{{ row.label }}</dt>
        <dd :class="['tabular-nums', index === props.totals.length - 1 && 'font-semibold']"><bdi dir="ltr">{{ row.value }}</bdi></dd>
      </div>
    </dl>
  </div>
</template>
