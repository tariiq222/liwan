<script setup lang="ts">
import BrandingForm from '@/components/settings/BrandingForm.vue'
import CompanyHeaderCard from '@/components/settings/CompanyHeaderCard.vue'
import CompanyProfileForm from '@/components/settings/CompanyProfileForm.vue'
import { useCompanyProfile } from '@/composables/useCompanyProfile'

// The company settings: one page of cards (profile, national address, contact, branding), each hidden from a user who
// lacks its capability. The sidebar sub-list scrolls to a card; the header card shows the company once above them.
const { t } = useI18n()
const { parts, shows } = useSettingsPage('company')
const { data: profile } = useCompanyProfile(() => shows('profile'))
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('settings.sections.company.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('settings.forbidden')" />
    <template v-else>
      <CompanyHeaderCard v-if="shows('profile') && profile" :profile="profile" />
      <section v-if="shows('profile')" id="profile" class="webvue-settings-anchor"><CompanyProfileForm section="profile" /></section>
      <section v-if="shows('address')" id="address" class="webvue-settings-anchor"><CompanyProfileForm section="address" /></section>
      <section v-if="shows('contact')" id="contact" class="webvue-settings-anchor"><CompanyProfileForm section="contact" /></section>
      <section v-if="shows('branding')" id="branding" class="webvue-settings-anchor"><BrandingForm /></section>
    </template>
  </SharedSettingsPage>
</template>
