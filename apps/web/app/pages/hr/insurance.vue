<script setup lang="ts">
import EnrollmentTable from '@/components/hr/insurance/EnrollmentTable.vue'
import InsuranceProvidersCard from '@/components/hr/insurance/InsuranceProvidersCard.vue'
import InsuranceSummaryStrip from '@/components/hr/insurance/InsuranceSummaryStrip.vue'
import PlanTable from '@/components/hr/insurance/PlanTable.vue'
import { HR_INSURANCE_ENROLLMENT_STATES, HR_INSURANCE_PLAN_STATES, type HrInsuranceEnrollmentState, type HrInsurancePlanState } from '@liwan/contracts'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { HR_INSURANCE_PAGE_SIZE } from '@/composables/useHrInsurance'

const SECTIONS = ['enrollments', 'plans', 'providers'] as const
type Section = typeof SECTIONS[number]

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const LIMIT = HR_INSURANCE_PAGE_SIZE
// The list is this page's own screen and stays behind its create panels; an enrollment or a plan record is a full page.
const isListRoute = computed(() => {
  const path = route.path.replace(/\/+$/, '') || '/'
  return can('hr.insurance.read') && ['/hr/insurance', '/hr/insurance/enrollments/new', '/hr/insurance/plans/new'].includes(path)
})

function positiveParam(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
const section = computed<Section>(() => {
  const raw = Array.isArray(route.query.section) ? route.query.section[0] : route.query.section
  return SECTIONS.find(candidate => candidate === raw) ?? 'enrollments'
})
function choice<T extends string>(value: unknown, allowed: readonly T[]): T | 'all' {
  const raw = Array.isArray(value) ? value[0] : value
  return allowed.find(candidate => candidate === raw) ?? 'all'
}
const employeeId = computed(() => positiveParam(route.query.employee_id))
const planId = computed(() => positiveParam(route.query.plan_id))
const enrollmentState = computed(() => choice<HrInsuranceEnrollmentState>(route.query.state, HR_INSURANCE_ENROLLMENT_STATES))
const planState = computed(() => choice<HrInsurancePlanState>(route.query.plan_state, HR_INSURANCE_PLAN_STATES))
const expiring = computed(() => route.query.expiring === 'true')
const offset = computed(() => Math.max(0, Number(route.query.offset ?? 0) || 0))

const enrollments = useHrInsuranceEnrollments(computed(() => ({
  employeeId: employeeId.value, planId: planId.value, state: enrollmentState.value, expiring: expiring.value, limit: LIMIT, offset: offset.value,
})), () => section.value === 'enrollments')
const plans = useHrInsurancePlans(computed(() => ({ state: planState.value, limit: LIMIT, offset: offset.value })), () => section.value === 'plans')
const planChoices = useHrInsurancePlans({ limit: 100 })
const providers = useHrInsuranceProviders('all', () => section.value === 'providers')
const settings = useHrInsuranceSettings()
const employees = useHrEmployees(computed(() => ({ limit: 100 })))

const active = computed(() => section.value === 'plans' ? plans : enrollments)
const items = computed(() => active.value.data.value?.items ?? [])
const total = computed(() => active.value.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / LIMIT) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / LIMIT)))
const showEmpty = computed(() => !active.value.isLoading.value && !active.value.error.value && items.value.length === 0)
const activeFilterCount = computed(() => section.value === 'plans'
  ? [planState.value === 'all' ? null : planState.value].filter(Boolean).length
  : [employeeId.value, planId.value, enrollmentState.value === 'all' ? null : enrollmentState.value, expiring.value || null].filter(Boolean).length)

const employeeOptions = computed(() => (employees.data.value?.items ?? []).map(employee => ({ value: String(employee.id), label: employee.name })))
const planOptions = computed(() => (planChoices.data.value?.items ?? []).map(plan => ({ value: String(plan.id), label: plan.name })))
const sectionItems = computed(() => SECTIONS.map(value => ({ value, label: t(`hrInsurance.section.${value}`), testId: `hr-insurance-section-${value}` })))
const enrollmentStateItems = computed(() => (['all', ...HR_INSURANCE_ENROLLMENT_STATES] as const).map(value => ({
  value, label: value === 'all' ? t('hrInsurance.allStates') : t(`hrInsurance.enrollmentState.${value}`), testId: `hr-insurance-state-${value}`,
})))
const planStateItems = computed(() => (['all', ...HR_INSURANCE_PLAN_STATES] as const).map(value => ({
  value, label: value === 'all' ? t('hrInsurance.allStates') : t(`hrInsurance.planState.${value}`), testId: `hr-insurance-plan-state-${value}`,
})))

type Patch = Partial<{ section: Section; employee: number | null; plan: number | null; state: string; planState: string; expiring: boolean; offset: number }>
function writeQuery(patch: Patch) {
  if (!hydrated.value) return
  const next = patch.section ?? section.value
  const state = patch.state ?? enrollmentState.value
  const planStateNext = patch.planState ?? planState.value
  const switching = patch.section !== undefined
  void router.replace({
    query: {
      section: next === 'enrollments' ? undefined : next,
      employee_id: switching ? undefined : (patch.employee !== undefined ? patch.employee : employeeId.value) ?? undefined,
      plan_id: switching ? undefined : (patch.plan !== undefined ? patch.plan : planId.value) ?? undefined,
      state: switching || state === 'all' ? undefined : state,
      plan_state: switching || planStateNext === 'all' ? undefined : planStateNext,
      expiring: switching ? undefined : (patch.expiring ?? expiring.value) ? 'true' : undefined,
      offset: (patch.offset ?? 0) > 0 ? patch.offset : undefined,
    },
    hash: route.hash,
  })
}
function setPage(next: number) {
  if (!hydrated.value || active.value.isFetching.value || next < 1 || next > pages.value) return
  writeQuery({ offset: (next - 1) * LIMIT })
}
function clearFilters() {
  void router.replace({ query: { section: route.query.section, offset: undefined }, hash: route.hash })
}

const listQuery = computed(() => {
  const { returnTo: _referrer, ...context } = route.query
  return context
})
const canManage = computed(() => can('hr.insurance.manage'))
const createTo = computed(() => {
  if (!canManage.value || section.value === 'providers') return undefined
  return { path: section.value === 'plans' ? '/hr/insurance/plans/new' : '/hr/insurance/enrollments/new', query: listQuery.value }
})
const enrollmentTo = (row: { id: number }) => ({ path: `/hr/insurance/enrollments/${row.id}`, query: returnToQuery(route.fullPath) })
const planTo = (row: { id: number }) => ({ path: `/hr/insurance/plans/${row.id}`, query: returnToQuery(route.fullPath) })
const alertDays = computed(() => settings.data.value?.insurance_expiry_alert_days ?? 60)
async function reloadProviders() {
  const result = await providers.refetch()
  if (result.isError) throw result.error
}
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    :title="t('nav.insurance')"
    :create-to="createTo"
    :create-label="t(section === 'plans' ? 'hrInsurance.newPlan' : 'hrInsurance.newEnrollment')"
    create-test-id="hr-insurance-new"
  >
    <InsuranceSummaryStrip />
    <SharedSegmentedControl :model-value="section" :items="sectionItems" :label="t('hrInsurance.sectionLabel')" :disabled="!hydrated" @update:model-value="writeQuery({ section: $event as Section })" />

    <template v-if="section === 'providers'">
      <SharedPageState :loading="providers.isLoading.value" :error="providers.data.value ? null : providers.error.value" :empty="!providers.data.value" @retry="providers.refetch">
        <InsuranceProvidersCard v-if="providers.data.value" :providers="providers.data.value.items" :can-edit="canManage" :reload-providers="reloadProviders" />
      </SharedPageState>
    </template>
    <SharedListCard v-else>
      <template #filters>
        <div class="liwan-page-stack">
          <SharedSegmentedControl
            v-if="section === 'enrollments'"
            :model-value="enrollmentState"
            :items="enrollmentStateItems"
            :label="t('hrInsurance.filter.state')"
            :disabled="!hydrated"
            @update:model-value="writeQuery({ state: $event, offset: 0 })"
          />
          <SharedSegmentedControl
            v-else
            :model-value="planState"
            :items="planStateItems"
            :label="t('hrInsurance.filter.state')"
            :disabled="!hydrated"
            @update:model-value="writeQuery({ planState: $event, offset: 0 })"
          />
          <SharedFilterBar v-if="section === 'enrollments'" embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
            <SharedFilterField :label="t('hrInsurance.columns.employee')" for="hr-insurance-filter-employee">
              <USelect id="hr-insurance-filter-employee" class="w-full" :model-value="employeeId ? String(employeeId) : undefined" :items="employeeOptions" :placeholder="t('hrInsurance.anyEmployee')" :disabled="!hydrated || employees.isLoading.value" data-testid="hr-insurance-filter-employee" @update:model-value="writeQuery({ employee: $event ? Number($event) : null, offset: 0 })" />
            </SharedFilterField>
            <SharedFilterField :label="t('hrInsurance.columns.plan')" for="hr-insurance-filter-plan">
              <USelect id="hr-insurance-filter-plan" class="w-full" :model-value="planId ? String(planId) : undefined" :items="planOptions" :placeholder="t('hrInsurance.anyPlan')" :disabled="!hydrated || planChoices.isLoading.value" data-testid="hr-insurance-filter-plan" @update:model-value="writeQuery({ plan: $event ? Number($event) : null, offset: 0 })" />
            </SharedFilterField>
            <SharedFilterField :label="t('hrInsurance.filter.expiringLabel')" for="hr-insurance-filter-expiring">
              <USwitch id="hr-insurance-filter-expiring" :model-value="expiring" :label="t('hrInsurance.filter.expiring', { days: alertDays }, alertDays)" :disabled="!hydrated" data-testid="hr-insurance-filter-expiring" @update:model-value="writeQuery({ expiring: Boolean($event), offset: 0 })" />
            </SharedFilterField>
            <template #active>
              <SharedFilterChip v-if="enrollmentState !== 'all'" :label="t(`hrInsurance.enrollmentState.${enrollmentState}`)" @remove="writeQuery({ state: 'all', offset: 0 })" />
            </template>
          </SharedFilterBar>
        </div>
      </template>

      <SharedPageState :error="active.error.value" :keep-content="items.length > 0" @retry="active.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--liwan-card-pad-dense)" :title="t(section === 'plans' ? 'hrInsurance.plansEmptyTitle' : 'hrInsurance.emptyTitle')" :description="t(section === 'plans' ? 'hrInsurance.plansEmptyHint' : 'hrInsurance.emptyHint')" />
        <PlanTable v-else-if="section === 'plans'" :plans="plans.data.value?.items ?? []" :row-to="planTo" :alert-days="alertDays" :loading="plans.isLoading.value" :caption="t('hrInsurance.section.plans')" />
        <EnrollmentTable v-else :enrollments="enrollments.data.value?.items ?? []" :row-to="enrollmentTo" :loading="enrollments.isLoading.value" :caption="t('hrInsurance.section.enrollments')" />
      </SharedPageState>
      <template v-if="active.data.value && !showEmpty" #footer>
        <SharedListFooter
          :count-label="t(section === 'plans' ? 'hrInsurance.plansFooter' : 'hrInsurance.footer', { shown: items.length, total }, total)"
          :page="page"
          :pages="pages"
          :disabled="active.isFetching.value"
          count-test-id="hr-insurance-count"
          @update:page="setPage"
        />
      </template>
    </SharedListCard>
  </SharedListPage>
  <NuxtPage />
</template>
