<script setup lang="ts">
import type { SalesOrderListItem } from '@liwan/contracts'
import { OPPORTUNITY_ORDER_STATE_TONE } from '@/utils/crmOrderGate'
import { formatCurrency } from '@/utils/formatCurrency'

// The quotations and orders of one opportunity (the CRM bridge to Sales): number, state, total and salesperson of each,
// linking to its page in Sales, and the action that writes a new quotation for the opportunity's customer. The page
// decides whether the section exists at all and why a new quotation is not offered (`blocked`): the server lists only
// the rows the caller may read in Sales, so a row never names a document the caller cannot open.
const props = defineProps<{
  orders: SalesOrderListItem[]
  total: number
  loading?: boolean
  error?: unknown
  canWrite: boolean
  blocked?: 'closed' | 'noCustomer' | null
  winByOrder?: boolean
  pending?: boolean
  formError?: string
}>()
const emit = defineEmits<{ create: []; retry: [] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const locked = computed(() => !hydrated.value || props.pending)
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('crm.opportunities.orders.title')" data-testid="crm-orders">
    <template v-if="canWrite && !blocked" #actions>
      <UButton size="xs" variant="outline" icon="i-lucide-plus" :label="t('crm.opportunities.orders.add')" :loading="props.pending" :disabled="locked" data-testid="crm-order-add" @click="emit('create')" />
    </template>
    <div class="grid gap-4">
      <p v-if="winByOrder" class="text-sm text-muted" data-testid="crm-orders-win">{{ t('crm.opportunities.orders.winHint') }}</p>
      <p v-if="canWrite && blocked" class="text-sm text-muted" data-testid="crm-orders-blocked">{{ t(`crm.opportunities.orders.blocked.${blocked}`) }}</p>
      <UAlert v-if="formError" role="alert" color="error" variant="subtle" :description="formError" data-testid="crm-order-error" />
      <SharedPageState :loading="loading" :error="error" :empty="!orders.length" :empty-text="t('crm.opportunities.orders.empty')" @retry="emit('retry')">
        <ul class="divide-y divide-default" data-testid="crm-order-list">
          <li v-for="order in orders" :key="order.id" class="grid gap-1 py-3 first:pt-0 last:pb-0">
            <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <NuxtLink :to="`/sales/${order.id}`" class="min-w-0 truncate font-semibold text-primary hover:underline">{{ order.number }}</NuxtLink>
              <SharedStatusBadge :tone="OPPORTUNITY_ORDER_STATE_TONE[order.state]" :label="t(`crm.opportunities.orders.state.${order.state}`)" size="sm" />
            </div>
            <p class="flex flex-wrap gap-x-3 text-sm text-muted">
              <bdi dir="ltr">{{ formatCurrency(order.amount_total, order.currency.name, locale) }}</bdi>
              <span>{{ order.salesperson?.name ?? t('crm.opportunities.orders.noSalesperson') }}</span>
            </p>
          </li>
        </ul>
        <p v-if="total > orders.length" class="mt-3 border-t border-default pt-3 text-sm text-muted">{{ t('crm.opportunities.orders.count', { shown: orders.length, total }) }}</p>
      </SharedPageState>
    </div>
  </SharedRecordSection>
</template>
