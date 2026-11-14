<script setup lang="ts">
import BrandingForm from '@/components/settings/BrandingForm.vue'
import CompanyHeaderCard from '@/components/settings/CompanyHeaderCard.vue'
import CompanyProfileForm from '@/components/settings/CompanyProfileForm.vue'
import CompanyTaxCard from '@/components/settings/CompanyTaxCard.vue'
import { useBrandingAdmin } from '@/composables/useBrandingAdmin'
import { useCompanyProfile } from '@/composables/useCompanyProfile'
import { useCompanyTax } from '@/composables/useCompanyTax'

// The company settings: one page of cards (profile, national address, contact, establishment tax, branding), each hidden
// from a user who lacks its capability. The sidebar sub-list scrolls to a card; the header card shows the company once
// above them. The establishment tax card exists only while the server carries `company_tax.enabled`; then it owns the
// VAT registration the profile card showed before, so the profile shows the number without a second switch for it.
const { t } = useI18n()
const { parts, shows } = useSettingsPage('company')
const showsProfile = computed(() => shows('profile') || shows('address') || shows('contact'))
const cardIds = computed(() => ['profile', 'address', 'contact'].filter(shows))
const { data: profile, isLoading, error, refetch } = useCompanyProfile(showsProfile)
// The part is registered behind the server's derived `company_tax.enabled`, so without that key it is absent here and the
// profile keeps its VAT switch.
const taxShown = computed(() => shows('tax'))
const tax = useCompanyTax(taxShown)
// The card itself owns the VAT switch only once it renders; while it loads or fails the profile keeps its control.
const taxReady = computed(() => taxShown.value && !!tax.data.value)
const { data: branding, isLoading: brandingLoading, error: brandingError, refetch: refetchBranding } = useBrandingAdmin(() => shows('branding'))
async function reloadTax() {
  const result = await tax.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('settings.sections.company.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('settings.forbidden')" />
    <template v-else>
      <!-- A card carries its own anchor; until it renders (loading or a failed load) an empty target keeps the sub-list link working. -->
      <template v-if="!profile">
        <span v-for="id in cardIds" :id="id" :key="id" class="liwan-settings-anchor block h-0" />
        <span v-if="taxShown" id="tax" class="liwan-settings-anchor block h-0" />
      </template>
      <SharedPageState v-if="showsProfile" :loading="isLoading" :error="error" @retry="refetch()">
        <template v-if="profile">
          <CompanyHeaderCard v-if="shows('profile')" :profile="profile" />
          <CompanyProfileForm v-if="shows('profile')" :profile="profile" section="profile" :tax-owns-vat="taxReady" />
          <CompanyProfileForm v-if="shows('address')" :profile="profile" section="address" />
          <CompanyProfileForm v-if="shows('contact')" :profile="profile" section="contact" />
        </template>
      </SharedPageState>
      <template v-if="taxShown && profile">
        <CompanyTaxCard v-if="tax.data.value" :tax="tax.data.value" :vat-number="profile.vat" :reload-tax="reloadTax" />
        <!-- The card carries the anchor once it exists; until then a target keeps a direct link to #tax landing here. -->
        <div v-else id="tax" class="liwan-settings-anchor">
          <SharedPageState :loading="tax.isLoading.value" :error="tax.error.value" :empty="false" @retry="tax.refetch()" />
        </div>
      </template>
      <span v-if="shows('branding') && !branding" id="branding" class="liwan-settings-anchor block h-0" />
      <SharedPageState v-if="shows('branding')" :loading="brandingLoading" :error="brandingError" @retry="refetchBranding()">
        <BrandingForm v-if="branding" :branding="branding" />
      </SharedPageState>
    </template>
  </SharedSettingsPage>
</template>
