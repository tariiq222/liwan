<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import AccountEditor from '@/components/finance/records/AccountEditor.vue'
import AccountsSection from '@/components/finance/records/AccountsSection.vue'

const LIST_PATH = '/settings/apps/finance/accounts'
const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const router = useRouter()
const canRead = computed(() => can('finance.accounts.read'))
const canManage = computed(() => can('finance.accounts.manage'))
const backTo = computed(() => safeReturnTo(route.query.returnTo, LIST_PATH, [LIST_PATH]))
</script>

<template>
  <SharedListPage :title="t('financeRecords.accounts.title')" hide-header>
    <AccountsSection v-if="canRead" background />
  </SharedListPage>
  <SharedCreatePanel :title="t('financeRecords.accounts.new')" :back-to="backTo">
    <AccountEditor v-if="canManage" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
    <SharedForbiddenState v-else :description="t('financeRecords.forbidden')" />
  </SharedCreatePanel>
</template>
