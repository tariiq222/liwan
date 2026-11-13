<script setup lang="ts">
import type { CustomerSettings } from '@liwan/contracts'
import { countryId, countryItems, countryValue } from '@/composables/customers/customerCountryItems'
import { useCustomerCountries } from '@/composables/customers/useCustomerCountries'
import { useCustomerSettingsCard } from '@/composables/customers/useCustomerSettingsCard'

// The country a phone number written without a country code is read in: any country, or the main company's own.
// The country list is read only by a manager, so a read-only card shows the saved country and fetches nothing.
const props = defineProps<{ settings: CustomerSettings; canEdit: boolean; reloadSettings: () => Promise<CustomerSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useCustomerSettingsCard({
  settings: () => props.settings,
  read: ({ phone_country }) => ({ phone_country_id: phone_country?.id ?? null }),
  toPatch: ({ phone_country_id }) => ({ phone_country_id }),
  reload: () => props.reloadSettings(),
})
const countries = useCustomerCountries(() => props.canEdit)
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const items = computed(() => countryItems(countries.data.value?.items ?? [], props.settings.phone_country, t('customers.settings.phoneCountry.main')))
const chosen = computed({
  get: () => countryValue(draft.value.phone_country_id),
  set: (value: string) => { draft.value.phone_country_id = countryId(value) },
})
</script>

<template>
  <SharedSettingsCard id="phoneCountry" v-bind="state" :title="t('customers.settings.phoneCountry.title')" :description="t('customers.settings.phoneCountry.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <SharedSettingRow :label="t('customers.settings.phoneCountry.current')" :description="t('customers.settings.phoneCountry.help')">
      <USelectMenu v-model="chosen" value-key="value" :items="items" :search-input="{ placeholder: t('customers.settings.phoneCountry.search') }" :loading="countries.isFetching.value" :aria-label="t('customers.settings.phoneCountry.current')" class="w-full min-w-56" :disabled="locked" data-testid="customers-phone-country" />
    </SharedSettingRow>
    <UAlert v-if="countries.error.value" role="alert" color="error" variant="subtle" :title="t('customers.settings.phoneCountry.loadError')">
      <template #actions><UButton type="button" color="neutral" variant="outline" size="sm" :label="t('customers.settings.phoneCountry.retry')" @click="countries.refetch()" /></template>
    </UAlert>
  </SharedSettingsCard>
</template>
