<script setup lang="ts">
import type { HrPayrollRelationship } from '@liwan/contracts'

// The non-blocking notice for a relationship other than employee: the customer's classification stands, the
// calculation still applies GOSI, WPS and end of service, and nothing here stops a run or a payment.
defineProps<{ relationship: HrPayrollRelationship }>()

const { t } = useI18n()
</script>

<template>
  <UAlert
    v-if="relationship !== 'employee'" role="status" color="warning" variant="subtle" icon="i-lucide-triangle-alert"
    :title="t('hrPayroll.compensation.relationshipWarningTitle')" :description="t('hrPayroll.compensation.relationshipWarningBody')"
    data-testid="hr-relationship-warning"
  />
</template>
