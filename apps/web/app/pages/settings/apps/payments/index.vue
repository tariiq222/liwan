<script setup lang="ts">
import OrderSettingsCard from '@/components/payments/OrderSettingsCard.vue'
import ProviderCard from '@/components/payments/ProviderCard.vue'
import { usePaymentProviders } from '@/composables/usePaymentProviders'
import { usePaymentSettings } from '@/composables/usePaymentSettings'

// The payments of the tenant: its payment gateways (each one is its own merchant account, connected here with its own
// keys) and the settings of the online orders customers pay. Every part is shown to the holder of its capability only.
const { t } = useI18n()
const { parts, shows } = useSettingsPage('payments')
const providers = usePaymentProviders(() => shows('providers'))
const items = computed(() => providers.data.value?.items ?? [])
const orders = usePaymentSettings(() => shows('orders'))
async function reloadOrderSettings() {
  const result = await orders.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('payments.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
      <SharedRecordSection v-if="shows('providers')" id="providers" class="webvue-settings-anchor" :title="t('payments.providers.title')" :description="t('payments.providers.hint')">
        <SharedPageState :loading="providers.isLoading.value" :error="providers.error.value" :empty="items.length === 0" :empty-text="t('payments.providers.empty')" @retry="providers.refetch()">
          <div class="grid gap-(--webvue-gap-card)" data-testid="payments-providers">
            <ProviderCard v-for="provider in items" :key="provider.id" :provider="provider" />
          </div>
        </SharedPageState>
      </SharedRecordSection>
      <section v-if="shows('orders')" id="orders" class="webvue-settings-anchor">
        <SharedPageState :loading="orders.isLoading.value" :error="orders.data.value ? null : orders.error.value" :empty="!orders.data.value" @retry="orders.refetch()">
          <OrderSettingsCard v-if="orders.data.value" :settings="orders.data.value" :reload-settings="reloadOrderSettings" />
        </SharedPageState>
      </section>
    </template>
  </SharedSettingsPage>
</template>
