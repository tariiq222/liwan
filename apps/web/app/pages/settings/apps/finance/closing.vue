<script setup lang="ts">
import ClosingView from '@/components/finance/governance/ClosingView.vue'
import { useFinanceFiscalYears } from '@/composables/finance/useFinanceClosing'
import type { PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'

const { t } = useI18n()
const { can } = useAccess()
const allowed = computed(() => can('finance.closing.read'))
const years = useFinanceFiscalYears(allowed)
const tags = computed<PageHeaderTag[]>(() => years.data.value
  ? [{ label: t('financeGovernance.closing.countTag', { count: years.data.value.total }, years.data.value.total), kind: 'count', testId: 'finance-closing-count' }]
  : [])
</script>

<template>
  <SharedSettingsPage width="detail">
    <SharedPageHeader :title="t('financeGovernance.closing.title')" :description="t('financeGovernance.closing.description')" :tags="tags" />
    <SharedForbiddenState v-if="!allowed" :description="t('financeGovernance.forbidden')" />
    <ClosingView v-else />
  </SharedSettingsPage>
</template>
