<script setup lang="ts">
import PlanTable from '@/components/hr/lifecycle/PlanTable.vue'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import { useHrOnboardingPlans, type HrPlanListParams } from '@/composables/useHrOnboarding'

const NAMESPACE = 'hrOnboarding'
const PAGE_SIZE = 25
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const forbidden = computed(() => !can('hr.onboarding.read'))
const canManage = computed(() => can('hr.onboarding.manage'))
const isList = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/hr/onboarding/plans')
const active = computed<'true' | 'false' | 'all'>(() => route.query.active === 'false' ? 'false' : route.query.active === 'all' ? 'all' : 'true')
const offset = computed(() => {
  const value = Number(route.query.offset)
  return Number.isSafeInteger(value) && value > 0 ? value : 0
})
const params = computed<HrPlanListParams>(() => ({ active: active.value, limit: PAGE_SIZE, offset: offset.value }))
const query = useHrOnboardingPlans(params, computed(() => !forbidden.value))
const plans = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const activeOptions = computed(() => [
  { value: 'true', label: t(`hrOnboarding.form.active`) },
  { value: 'false', label: t(`hrOnboarding.plans.activate`) },
  { value: 'all', label: t(`hrOnboarding.plans.everyState`) },
])
const listQuery = computed(() => {
  const { returnTo: _returnTo, ...rest } = route.query
  return rest
})
const createTo = computed(() => canManage.value ? { path: '/hr/onboarding/plans/new', query: listQuery.value } : undefined)
const planTo = (plan: { id: number }) => ({ path: `/hr/onboarding/plans/${plan.id}`, query: listQuery.value })
function syncQuery(next: { active?: string, offset?: number }) {
  if (!isList.value) return
  void router.replace({ query: {
    ...(next.active && next.active !== 'true' ? { active: next.active } : {}),
    ...(next.offset ? { offset: String(next.offset) } : {}),
  } })
}
function setActive(value: unknown) {
  syncQuery({ active: String(value ?? 'true'), offset: 0 })
}
function setPage(next: number) {
  if (hydrated.value && next >= 1 && next <= pages.value) syncQuery({ active: active.value, offset: (next - 1) * PAGE_SIZE })
}
const toggleError = ref<unknown>(null)
const toggling = ref<number | null>(null)
const { mutateAsync: patchPlan } = usePatchHrOnboardingPlan()
async function confirmToggle(plan: { id: number, name: string, active: boolean }) {
  if (!hydrated.value || !canManage.value || toggling.value !== null) return
  toggling.value = plan.id
  try {
    await patchPlan({ id: plan.id, patch: { active: !plan.active } })
    toggleError.value = null
    pendingToggle.value = null
  } catch (error) {
    toggleError.value = error
  } finally { toggling.value = null }
}
const pendingToggle = ref<{ id: number, name: string, active: boolean } | null>(null)
function askToggle(plan: { id: number, name: string, active: boolean }) {
  pendingToggle.value = plan
  toggleError.value = null
}
</script>

<template>
  <SharedListPage
    data-testid="hr-onboarding-plans"
    :title="t(`hrOnboarding.plans.title`)"
    :create-to="createTo"
    :create-label="t(`hrOnboarding.plans.new`)"
    create-test-id="hr-onboarding-plan-new"
  >
    <SharedForbiddenState v-if="forbidden" :description="t(`hrOnboarding.errors.forbidden`)" />
    <SharedListCard v-else>
      <template #filters>
        <div id="filters" class="w-full min-w-0">
          <FilterBar embedded class="w-full" :active-count="active !== 'true' ? 1 : 0" :disabled="!hydrated" @clear="setActive('true')">
            <template #default>
              <USelect
                class="w-full md:w-56"
                :items="activeOptions"
                :model-value="active"
                :aria-label="t(`hrOnboarding.form.active`)"
                :disabled="!hydrated"
                @update:model-value="setActive"
              />
            </template>
          </FilterBar>
        </div>
      </template>
      <SharedInlineConfirm
        v-if="pendingToggle"
        class="m-(--webvue-card-pad-dense)"
        :title="t(`hrOnboarding.plans.deactivateTitle`)"
        :description="toggleError ? t(`hrOnboarding.form.saveError`) : t(`hrOnboarding.plans.deactivateDescription`)"
        :confirm-label="pendingToggle.active ? t(`hrOnboarding.plans.deactivate`) : t(`hrOnboarding.plans.activate`)"
        :pending="toggling === pendingToggle.id"
        @confirm="confirmToggle(pendingToggle)"
        @cancel="pendingToggle = null"
      />
      <SharedPageState
        v-if="query.isLoading.value || query.error.value || !plans.length"
        class="m-(--webvue-card-pad-dense)"
        :loading="query.isLoading.value"
        :error="query.error.value"
        :empty="!plans.length"
        :empty-text="t(`hrOnboarding.plans.empty`)"
        @retry="query.refetch"
      />
      <PlanTable v-else :plans="plans" :namespace="NAMESPACE" :to-for="planTo" :can-manage="canManage" @toggle="askToggle" />
      <template v-if="plans.length" #footer>
        <SharedListFooter
          :count-label="t(`hrOnboarding.footer.results`, { shown: plans.length, total }, total)"
          :page="page"
          :pages="pages"
          :disabled="query.isFetching.value"
          @update:page="setPage"
        />
      </template>
    </SharedListCard>
  </SharedListPage>
</template>
