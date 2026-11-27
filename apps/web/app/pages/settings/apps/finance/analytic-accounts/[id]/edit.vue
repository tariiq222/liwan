<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import AnalyticAccountEditor from '@/components/finance/analytic/AnalyticAccountEditor.vue'
import { useFinanceAnalyticAccount, useFinanceAnalyticPlans } from '@/composables/finance/useFinanceAnalytic'

const DEFAULT_BACK_TO = '/settings/apps/finance?tab=accounting#analytic'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canManage = computed(() => can('finance.analytic.manage'))
const id = computed(() => {
  const raw = typeof route.params.id === 'string' ? route.params.id : ''
  if (!/^\d+$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
})
const backTo = computed(() => safeReturnTo(route.query.returnTo, DEFAULT_BACK_TO, ['/settings/apps/finance']))
const accountQuery = useFinanceAnalyticAccount(id, canManage)
const plansQuery = useFinanceAnalyticPlans(() => canManage.value && id.value !== null)
const account = computed(() => accountQuery.data.value ?? null)
const planList = computed(() => plansQuery.data.value?.items ?? [])
const loading = computed(() => id.value !== null && (accountQuery.isPending.value || plansQuery.isPending.value))
const error = computed(() => id.value === null ? { status: 404 } : (accountQuery.error.value ?? plansQuery.error.value))
function retry() {
  if (!hydrated.value) return
  if (accountQuery.error.value) void accountQuery.refetch()
  if (plansQuery.error.value) void plansQuery.refetch()
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('financeAnalytic.accounts.editTitle')" :back-to="backTo" :back-label="t('financeAnalytic.accounts.title')" />
    <SharedForbiddenState v-if="!canManage" :description="t('financeAnalytic.forbidden')" />
    <SharedPageState v-else :loading="loading" :error="error" @retry="retry">
      <SharedFormSection v-if="account" panel>
        <AnalyticAccountEditor :key="account.id" :account="account" :plans="planList" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
      </SharedFormSection>
    </SharedPageState>
  </SharedPageContainer>
</template>
