<script setup lang="ts">
import ProviderCard from '@/components/payments/ProviderCard.vue'
import { usePaymentProviders } from '@/composables/usePaymentProviders'

// The payment gateways of the tenant: each one is its own merchant account, connected here with its own keys.
const { t } = useI18n()
const { parts, shows } = useSettingsPage('payments')
const providers = usePaymentProviders(() => shows('providers'))
const items = computed(() => providers.data.value?.items ?? [])
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('payments.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <SharedRecordSection v-else id="providers" class="webvue-settings-anchor" :title="t('payments.providers.title')" :description="t('payments.providers.hint')">
      <SharedPageState :loading="providers.isLoading.value" :error="providers.error.value" :empty="items.length === 0" :empty-text="t('payments.providers.empty')" @retry="providers.refetch()">
        <div class="grid gap-(--webvue-gap-card)" data-testid="payments-providers">
          <ProviderCard v-for="provider in items" :key="provider.id" :provider="provider" />
        </div>
      </SharedPageState>
    </SharedRecordSection>
  </SharedSettingsPage>
</template>
