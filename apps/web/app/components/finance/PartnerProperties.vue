<script setup lang="ts">
import type { FinancePartner } from '@/composables/finance/useFinancePartners'

// The partner record's facts as the aside PropertiesPanel. A missing value is the row's empty form (a dash, spoken as "no value");
// tax and registration numbers read left to right inside the Arabic page.
defineProps<{ partner: FinancePartner }>()
const { t } = useI18n()
</script>

<template>
  <SharedPropertiesPanel>
    <SharedPropertyRow v-if="partner.vat" :label="t('finance.partners.form.vat')"><bdi dir="ltr">{{ partner.vat }}</bdi></SharedPropertyRow>
    <SharedPropertyRow v-else :label="t('finance.partners.form.vat')" />
    <SharedPropertyRow v-if="partner.company_registry" :label="t('finance.partners.form.companyRegistry')"><bdi dir="ltr">{{ partner.company_registry }}</bdi></SharedPropertyRow>
    <SharedPropertyRow v-else :label="t('finance.partners.form.companyRegistry')" />
    <SharedPropertyRow :label="t('finance.partners.form.street')" :value="partner.street" />
    <SharedPropertyRow :label="t('finance.partners.form.city')" :value="partner.city" />
    <SharedPropertyRow :label="t('finance.partners.form.state')" :value="partner.state?.name" />
    <SharedPropertyRow :label="t('finance.partners.form.country')" :value="partner.country?.name" />
  </SharedPropertiesPanel>
</template>
