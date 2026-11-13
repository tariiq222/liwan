<script setup lang="ts">
import CustomerFieldsCard from '@/components/customers/settings/CustomerFieldsCard.vue'
import CustomerPartyKindsCard from '@/components/customers/settings/CustomerPartyKindsCard.vue'
import CustomerPhoneCountryCard from '@/components/customers/settings/CustomerPhoneCountryCard.vue'
import CustomerSharingCard from '@/components/customers/settings/CustomerSharingCard.vue'
import { useCustomerSettings } from '@/composables/customers/useCustomerSettings'

// The customers service's settings under Settings > Applications: one card per setting. Reading needs `customers.read`
// or `customers.settings.manage`; changing needs the capability in the main company as well, which the server reports as
// `can_manage`. Without it the whole page is read-only and says why. Each card saves only its own fields with the
// revision it was made from, through the page's one save bar.
const { t } = useI18n()
const { parts, shows } = useSettingsPage('customers')
const settings = useCustomerSettings()
async function reloadSettings() {
  const result = await settings.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('customers.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
      <SharedPageState :loading="settings.isLoading.value" :error="settings.data.value ? null : settings.error.value" :empty="!settings.data.value" @retry="settings.refetch">
        <template v-if="settings.data.value">
          <UAlert v-if="!settings.data.value.can_manage" color="info" variant="subtle" icon="i-lucide-lock" :title="t('customers.settings.readOnlyTitle')" :description="t('customers.settings.readOnly')" data-testid="customers-settings-readonly" />
          <CustomerSharingCard v-if="shows('sharing')" :settings="settings.data.value" :can-edit="settings.data.value.can_manage" :reload-settings="reloadSettings" />
          <CustomerPartyKindsCard v-if="shows('partyKinds')" :settings="settings.data.value" :can-edit="settings.data.value.can_manage" :reload-settings="reloadSettings" />
          <CustomerPhoneCountryCard v-if="shows('phoneCountry')" :settings="settings.data.value" :can-edit="settings.data.value.can_manage" :reload-settings="reloadSettings" />
          <CustomerFieldsCard v-if="shows('fields')" :settings="settings.data.value" :can-edit="settings.data.value.can_manage" :reload-settings="reloadSettings" />
        </template>
      </SharedPageState>
    </template>
  </SharedSettingsPage>
</template>
