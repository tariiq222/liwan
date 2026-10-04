<script setup lang="ts">
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { formatSubscriptionMoney } from '@/utils/subscription'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t, locale } = useI18n(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities()
const allowed = computed(() => can('billing.read'))
const { data, error, pending, refresh } = await useAsyncData('subscription:invoices', () => api.invoices(), { immediate: allowed.value })
const items = computed(() => data.value?.items ?? [])
definePageMeta({ middleware: 'customer-commercial' })
</script>
<template>
  <SettingsLayout width="list">
    <SharedPageHeader :title="t('subscription.invoices.title')" :description="t('subscription.invoices.description')" back-to="/subscription" />
    <p v-if="!allowed" class="text-muted">{{ t('subscription.forbidden') }}</p>
    <SharedPageState v-else :loading="pending" :error="error" :empty="!pending && !error && !items.length" :empty-text="t('subscription.invoices.empty')" @retry="refresh">
      <ul class="divide-y divide-default rounded-lg ring ring-default">
        <li v-for="inv in items" :key="inv.id" class="flex flex-wrap items-center justify-between gap-3 p-3" data-testid="invoice-row">
          <NuxtLink :to="`/subscription/invoices/${encodeURIComponent(inv.id)}`" class="font-medium">{{ inv.number ?? inv.id }}</NuxtLink>
          <span class="text-sm text-muted tabular-nums"><bdi dir="ltr">{{ inv.period_start }} → {{ inv.period_end }}</bdi></span>
          <UBadge color="neutral" variant="subtle">{{ t(`subscription.invoices.statuses.${inv.status}`) }}</UBadge>
          <span class="font-semibold tabular-nums">{{ formatSubscriptionMoney(inv.total, locale) }}</span>
        </li>
      </ul>
    </SharedPageState>
  </SettingsLayout>
</template>
