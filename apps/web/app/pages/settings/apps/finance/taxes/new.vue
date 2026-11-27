<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import TaxEditor from '@/components/finance/records/TaxEditor.vue'
import TaxesSection from '@/components/finance/records/TaxesSection.vue'

const LIST_PATH = '/settings/apps/finance/taxes'
const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const router = useRouter()
const canRead = computed(() => can('finance.taxes.read'))
const canManage = computed(() => can('finance.taxes.manage'))
const backTo = computed(() => safeReturnTo(route.query.returnTo, LIST_PATH, [LIST_PATH]))
</script>

<template>
  <SharedListPage :title="t('financeRecords.taxes.title')" hide-header>
    <TaxesSection v-if="canRead" background />
  </SharedListPage>
  <SharedCreatePanel :title="t('financeRecords.taxes.new')" :back-to="backTo">
    <TaxEditor v-if="canManage" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
    <SharedForbiddenState v-else :description="t('financeRecords.forbidden')" />
  </SharedCreatePanel>
</template>
