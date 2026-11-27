<script setup lang="ts">
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import TaxesSection from '@/components/finance/records/TaxesSection.vue'

const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const allowed = computed(() => can('finance.taxes.read'))
const canManage = computed(() => can('finance.taxes.manage'))
</script>

<template>
  <SharedListPage
    :title="t('financeRecords.taxes.title')"
    :description="t('financeRecords.taxes.description')"
    :create-to="allowed && canManage ? { path: '/settings/apps/finance/taxes/new', query: returnToQuery(route.fullPath) } : undefined"
    :create-label="t('financeRecords.taxes.new')"
    create-test-id="finance-record-tax-new"
  >
    <SharedForbiddenState v-if="!allowed" :description="t('financeRecords.forbidden')" />
    <TaxesSection v-else />
  </SharedListPage>
</template>
