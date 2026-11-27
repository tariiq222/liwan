<script setup lang="ts">
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import AccountsSection from '@/components/finance/records/AccountsSection.vue'

const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const allowed = computed(() => can('finance.accounts.read'))
const canManage = computed(() => can('finance.accounts.manage'))
</script>

<template>
  <SharedListPage
    :title="t('financeRecords.accounts.title')"
    :description="t('financeRecords.accounts.description')"
    :create-to="allowed && canManage ? { path: '/settings/apps/finance/accounts/new', query: returnToQuery(route.fullPath) } : undefined"
    :create-label="t('financeRecords.accounts.new')"
    create-test-id="finance-record-account-new"
  >
    <SharedForbiddenState v-if="!allowed" :description="t('financeRecords.forbidden')" />
    <AccountsSection v-else />
  </SharedListPage>
</template>
