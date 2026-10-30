<script setup lang="ts">
import BrandingForm from '@/components/settings/BrandingForm.vue'
import CompanyHeaderCard from '@/components/settings/CompanyHeaderCard.vue'
import CompanyProfileForm from '@/components/settings/CompanyProfileForm.vue'
import { useBrandingAdmin } from '@/composables/useBrandingAdmin'
import { useCompanyProfile } from '@/composables/useCompanyProfile'

// The company settings: one page of cards (profile, national address, contact, branding), each hidden from a user who
// lacks its capability. The sidebar sub-list scrolls to a card; the header card shows the company once above them.
const { t } = useI18n()
const { parts, shows } = useSettingsPage('company')
const showsProfile = computed(() => shows('profile') || shows('address') || shows('contact'))
const cardIds = computed(() => ['profile', 'address', 'contact'].filter(shows))
const { data: profile, isLoading, error, refetch } = useCompanyProfile(showsProfile)
const { data: branding, isLoading: brandingLoading, error: brandingError, refetch: refetchBranding } = useBrandingAdmin(() => shows('branding'))
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('settings.sections.company.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('settings.forbidden')" />
    <template v-else>
      <!-- A card carries its own anchor; until it renders (loading or a failed load) an empty target keeps the sub-list link working. -->
      <template v-if="!profile"><span v-for="id in cardIds" :id="id" :key="id" class="liwan-settings-anchor block h-0" /></template>
      <SharedPageState v-if="showsProfile" :loading="isLoading" :error="error" @retry="refetch()">
        <template v-if="profile">
          <CompanyHeaderCard v-if="shows('profile')" :profile="profile" />
          <CompanyProfileForm v-if="shows('profile')" :profile="profile" section="profile" />
          <CompanyProfileForm v-if="shows('address')" :profile="profile" section="address" />
          <CompanyProfileForm v-if="shows('contact')" :profile="profile" section="contact" />
        </template>
      </SharedPageState>
      <span v-if="shows('branding') && !branding" id="branding" class="liwan-settings-anchor block h-0" />
      <SharedPageState v-if="shows('branding')" :loading="brandingLoading" :error="brandingError" @retry="refetchBranding()">
        <BrandingForm v-if="branding" :branding="branding" />
      </SharedPageState>
    </template>
  </SharedSettingsPage>
</template>
