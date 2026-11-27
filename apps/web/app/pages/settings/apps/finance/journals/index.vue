<script setup lang="ts">
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import JournalsSection from '@/components/finance/records/JournalsSection.vue'

const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const allowed = computed(() => can('finance.journals.read'))
const canManage = computed(() => can('finance.journals.manage'))
</script>

<template>
  <SharedListPage
    :title="t('financeRecords.journals.title')"
    :description="t('financeRecords.journals.description')"
    :create-to="allowed && canManage ? { path: '/settings/apps/finance/journals/new', query: returnToQuery(route.fullPath) } : undefined"
    :create-label="t('financeRecords.journals.new')"
    create-test-id="finance-record-journal-new"
  >
    <SharedForbiddenState v-if="!allowed" :description="t('financeRecords.forbidden')" />
    <JournalsSection v-else />
  </SharedListPage>
</template>
