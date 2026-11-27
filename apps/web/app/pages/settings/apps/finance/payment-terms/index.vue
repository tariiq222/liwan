<script setup lang="ts">
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import PaymentTermsSection from '@/components/finance/records/PaymentTermsSection.vue'

const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const allowed = computed(() => can('finance.payment_terms.read'))
const canManage = computed(() => can('finance.payment_terms.manage'))
</script>

<template>
  <SharedListPage
    :title="t('financeRecords.paymentTerms.title')"
    :description="t('financeRecords.paymentTerms.description')"
    :create-to="canManage ? { path: '/settings/apps/finance/payment-terms/new', query: returnToQuery(route.fullPath) } : undefined"
    :create-label="t('financeRecords.paymentTerms.new')"
    create-test-id="finance-record-term-new"
  >
    <SharedForbiddenState v-if="!allowed" :description="t('financeRecords.forbidden')" />
    <PaymentTermsSection v-else />
  </SharedListPage>
</template>
