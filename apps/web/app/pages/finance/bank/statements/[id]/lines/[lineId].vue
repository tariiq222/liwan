<script setup lang="ts">
import ReconcileBody from '@/components/finance/bank/ReconcileBody.vue'
import { useBankReconcilePage } from '@/components/finance/bank/useBankReconcilePage'

const { t } = useI18n()
const page = useBankReconcilePage()
</script>

<template>
  <SharedRecordPage v-bind="page.header" @retry="page.retry">
    <ReconcileBody v-if="page.allowed" :page="page" />
    <SharedForbiddenState v-else :description="t('financeBank.forbidden')" />
  </SharedRecordPage>
</template>
