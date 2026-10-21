<script setup lang="ts">
import TaxesSection from '@/components/finance/records/TaxesSection.vue'

const { t } = useI18n()
const { can } = useAccess()
const allowed = computed(() => can('finance.taxes.read'))
</script>

<template>
  <SharedSettingsPage width="detail">
    <SharedPageHeader :title="t('financeRecords.taxes.title')" />
    <SharedForbiddenState v-if="!allowed" :description="t('financeRecords.forbidden')" />
    <TaxesSection v-else />
  </SharedSettingsPage>
</template>
