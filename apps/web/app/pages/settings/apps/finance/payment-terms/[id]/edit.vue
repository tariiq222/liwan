<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import PaymentTermEditor from '@/components/finance/records/PaymentTermEditor.vue'
import { useSetupPaymentTerm } from '@/composables/finance/useFinanceRecords'
import { queryPositiveInt } from '@/utils/routeQuery'

const LIST_PATH = '/settings/apps/finance/payment-terms'
const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const router = useRouter()
const canManage = computed(() => can('finance.payment_terms.manage'))
const id = computed(() => queryPositiveInt(route.params.id))
const query = useSetupPaymentTerm(id, canManage)
const backTo = computed(() => safeReturnTo(route.query.returnTo, LIST_PATH, [LIST_PATH]))
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader
      :title="t('financeRecords.paymentTerms.editTitle')"
      :back-to="backTo"
      :back-label="t('financeRecords.paymentTerms.title')"
    />
    <SharedForbiddenState v-if="!canManage" :description="t('financeRecords.forbidden')" />
    <SharedPageState
      v-else
      :loading="id !== null && query.isPending.value"
      :error="id === null ? { status: 404 } : query.error.value"
      @retry="query.refetch()"
    >
      <SharedForbiddenState v-if="query.data.value?.shared" :description="t('financeRecords.paymentTerms.sharedReadOnly')" />
      <SharedFormSection v-else-if="query.data.value" panel>
        <PaymentTermEditor
          :key="query.data.value.id"
          :term="query.data.value"
          @done="router.replace(backTo)"
          @cancel="router.push(backTo)"
        />
      </SharedFormSection>
    </SharedPageState>
  </SharedPageContainer>
</template>
