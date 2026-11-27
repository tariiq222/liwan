<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import AnalyticAccountEditor from '@/components/finance/analytic/AnalyticAccountEditor.vue'
import AnalyticAccountsSection from '@/components/finance/analytic/AnalyticAccountsSection.vue'
import AnalyticPlansSection from '@/components/finance/analytic/AnalyticPlansSection.vue'
import { useFinanceAnalyticPlans } from '@/composables/finance/useFinanceAnalytic'

const DEFAULT_BACK_TO = '/settings/apps/finance?tab=accounting#analytic'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const canManage = computed(() => can('finance.analytic.manage'))
const backTo = computed(() => safeReturnTo(route.query.returnTo, DEFAULT_BACK_TO, ['/settings/apps/finance']))
const plans = useFinanceAnalyticPlans(canManage)
const planList = computed(() => plans.data.value?.items ?? [])
</script>

<template>
  <SharedSettingsPage>
    <AnalyticPlansSection />
    <AnalyticAccountsSection background />
  </SharedSettingsPage>
  <SharedCreatePanel :title="t('financeAnalytic.accounts.new')" :back-to="backTo">
    <SharedForbiddenState v-if="!canManage" :description="t('financeAnalytic.forbidden')" />
    <SharedPageState
      v-else
      :loading="plans.isPending.value"
      :error="plans.error.value"
      :empty="!plans.isPending.value && planList.length === 0"
      :empty-text="t('financeAnalytic.plans.empty')"
      empty-icon="i-lucide-chart-pie"
      @retry="plans.refetch"
    >
      <AnalyticAccountEditor :plans="planList" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
