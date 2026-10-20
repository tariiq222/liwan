<script setup lang="ts">
import AnalyticAccountsSection from '@/components/finance/analytic/AnalyticAccountsSection.vue'
import AnalyticPlansSection from '@/components/finance/analytic/AnalyticPlansSection.vue'
import { useFinanceAnalyticPlans } from '@/composables/finance/useFinanceAnalytic'
import type { PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'

const { t } = useI18n()
const { can } = useAccess()
const allowed = computed(() => can('finance.analytic.read'))
const plans = useFinanceAnalyticPlans(allowed)
const tags = computed<PageHeaderTag[]>(() => plans.data.value
  ? [{ label: t('financeAnalytic.plans.countTag', { count: plans.data.value.total }, plans.data.value.total), kind: 'count', testId: 'finance-analytic-plan-count' }]
  : [])
</script>

<template>
  <SharedSettingsPage width="detail">
    <SharedPageHeader :title="t('financeAnalytic.title')" :description="t('financeAnalytic.description')" :tags="tags" />
    <SharedForbiddenState v-if="!allowed" :description="t('financeAnalytic.forbidden')" />
    <div v-else class="grid gap-(--webvue-gap-card)">
      <AnalyticPlansSection />
      <AnalyticAccountsSection />
    </div>
  </SharedSettingsPage>
</template>
