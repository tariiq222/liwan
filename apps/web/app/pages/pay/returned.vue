<script setup lang="ts">
import PayHeader from '@/components/payments/PayHeader.vue'

// The gateway sent the payer back but their link was not remembered (another browser, or the hour passed), so there is
// no invoice to show. The page only says the result was received.
definePageMeta({ layout: false, access: 'public' })

const { t } = useI18n()
</script>

<template>
  <SharedStandalonePage>
    <template #header><PayHeader :title="t('payments.returned.title')" /></template>
    <UAlert role="status" color="info" variant="subtle" icon="i-lucide-circle-check" :title="t('payments.returned.alertTitle')" :description="t('payments.returned.body')" data-testid="pay-returned" />
  </SharedStandalonePage>
</template>
