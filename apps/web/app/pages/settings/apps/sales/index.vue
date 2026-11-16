<script setup lang="ts">
import SalesInvoicingCard from '@/components/sales/settings/SalesInvoicingCard.vue'
import SalesOpportunityCard from '@/components/sales/settings/SalesOpportunityCard.vue'
import SalesPaymentCard from '@/components/sales/settings/SalesPaymentCard.vue'
import SalesQuotationsCard from '@/components/sales/settings/SalesQuotationsCard.vue'
import SalesVisibilityCard from '@/components/sales/settings/SalesVisibilityCard.vue'
import { useSalesSettings } from '@/composables/sales/useSalesSettings'

// The sales settings under Settings > Applications: one card per group. Changing needs `sales.settings.manage` in the
// main company, which the server reports as `can_manage`; without it the page is read-only and says why. Each card
// saves only its own fields with the revision it was made from, through the page's one save bar.
const { t } = useI18n()
const { parts, shows } = useSettingsPage('sales')
const settings = useSalesSettings()
async function reloadSettings() {
  const result = await settings.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('sales.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
      <SharedPageState :loading="settings.isLoading.value" :error="settings.data.value ? null : settings.error.value" :empty="!settings.data.value" @retry="settings.refetch">
        <template v-if="settings.data.value">
          <UAlert v-if="!settings.data.value.can_manage" color="info" variant="subtle" icon="i-lucide-lock" :title="t('sales.settings.readOnlyTitle')" :description="t('sales.settings.readOnly')" data-testid="sales-settings-readonly" />
          <SalesVisibilityCard v-if="shows('visibility')" :settings="settings.data.value" :can-edit="settings.data.value.can_manage" :reload-settings="reloadSettings" />
          <SalesQuotationsCard v-if="shows('quotations')" :settings="settings.data.value" :can-edit="settings.data.value.can_manage" :reload-settings="reloadSettings" />
          <SalesInvoicingCard v-if="shows('invoicing') && settings.data.value.invoice_down_payment !== undefined" :settings="settings.data.value" :can-edit="settings.data.value.can_manage" :reload-settings="reloadSettings" />
          <SalesOpportunityCard v-if="shows('opportunity') && settings.data.value.opportunity_win !== undefined" :settings="settings.data.value" :can-edit="settings.data.value.can_manage" :reload-settings="reloadSettings" />
          <SalesPaymentCard v-if="shows('payments') && settings.data.value.payment_to_confirm !== undefined" :settings="settings.data.value" :can-edit="settings.data.value.can_manage" :reload-settings="reloadSettings" />
        </template>
      </SharedPageState>
    </template>
  </SharedSettingsPage>
</template>
