<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import PaymentTermEditor from '@/components/finance/records/PaymentTermEditor.vue'
import PaymentTermsSection from '@/components/finance/records/PaymentTermsSection.vue'

const LIST_PATH = '/settings/apps/finance/payment-terms'
const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const router = useRouter()
const canRead = computed(() => can('finance.payment_terms.read'))
const canManage = computed(() => can('finance.payment_terms.manage'))
const backTo = computed(() => safeReturnTo(route.query.returnTo, LIST_PATH, [LIST_PATH]))
</script>

<template>
  <SharedListPage :title="t('financeRecords.paymentTerms.title')" hide-header>
    <PaymentTermsSection v-if="canRead" background />
  </SharedListPage>
  <SharedCreatePanel :title="t('financeRecords.paymentTerms.new')" :back-to="backTo">
    <PaymentTermEditor v-if="canManage" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
    <SharedForbiddenState v-else :description="t('financeRecords.forbidden')" />
  </SharedCreatePanel>
</template>
