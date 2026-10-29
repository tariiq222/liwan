<script setup lang="ts">
import PaymentTermsSection from '@/components/finance/records/PaymentTermsSection.vue'

const { t } = useI18n()
const { can } = useAccess()
const allowed = computed(() => can('finance.payment_terms.read'))
</script>

<template>
  <SharedSettingsPage width="list">
    <SharedPageHeader :title="t('financeRecords.paymentTerms.title')" />
    <SharedForbiddenState v-if="!allowed" :description="t('financeRecords.forbidden')" />
    <PaymentTermsSection v-else />
  </SharedSettingsPage>
</template>
