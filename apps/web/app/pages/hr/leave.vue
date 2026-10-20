<script setup lang="ts">
import { h } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import { ApiError } from '@/composables/useApi'
import {
  useHrLeaveBalances,
  useHrLeaveRequests,
  useLeaveDecision,
  useWithdrawLeaveRequest,
  type HrLeave,
  type HrLeaveDecision,
  type HrLeaveScope,
} from '@/composables/useHrLeave'
import { useHrLeaveFormat } from '@/composables/useHrLeaveFormat'
import { hrLeaveBadge } from '@/utils/hrLeaveBadge'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t, n } = useI18n()
const { period, days } = useHrLeaveFormat()
const hydrated = useHydrated()
const { shown: kpisShown } = useKpiVisibility()
const { can } = useAccess()

const LIMIT = 25
const isListRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/hr/leave')
const canApprove = computed(() => can('hr.leave.approve'))
const canAllocate = computed(() => can('hr.leave.manage'))
const canRequest = computed(() => can('hr.leave.request'))

function scopeFrom(value: unknown): HrLeaveScope {
  if (canApprove.value && (value === 'pending' || value === 'all')) return value
  return 'mine'
}
const scope = computed(() => scopeFrom(route.query.scope))
const offset = computed(() => Math.max(0, Number(route.query.offset ?? 0) || 0))
const params = computed(() => ({ scope: scope.value, limit: LIMIT, offset: offset.value }))

const requests = useHrLeaveRequests(params, isListRoute)
const balances = useHrLeaveBalances(null, isListRoute)
const decision = useLeaveDecision()
const withdrawal = useWithdrawLeaveRequest()

const items = computed(() => requests.data.value?.items ?? [])
const total = computed(() => requests.data.value?.total ?? 0)
// The list's total as a tag in the heading, once the first page has arrived.
const countTags = computed(() => requests.data.value ? [{ label: t('hr.leave.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
const page = computed(() => Math.floor(offset.value / LIMIT) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / LIMIT)))
const showEmpty = computed(() => !requests.isLoading.value && !requests.error.value && items.value.length === 0)
const balanceItems = computed(() => balances.data.value?.items ?? [])

const scopeItems = computed(() => [
  { value: 'mine', label: t('hr.leave.scope.mine'), testId: 'hr-leave-scope-mine' },
  ...(canApprove.value
    ? [
        { value: 'pending', label: t('hr.leave.scope.pending'), testId: 'hr-leave-scope-pending' },
        { value: 'all', label: t('hr.leave.scope.all'), testId: 'hr-leave-scope-all' },
      ]
    : []),
])

const columns = computed<TableColumn<HrLeave>[]>(() => [
  { accessorKey: 'id', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  ...(scope.value === 'mine' ? [] : [{ accessorKey: 'employee', header: t('hr.leave.columns.employee') }]),
  { accessorKey: 'leave_type', header: t('hr.leave.columns.type') },
  { accessorKey: 'date_from', header: t('hr.leave.columns.period') },
  { accessorKey: 'number_of_days', header: t('hr.leave.columns.days') },
  { accessorKey: 'state', header: t('hr.leave.columns.state') },
  { id: 'actions', header: () => h('span', { class: 'sr-only' }, t('app.actions')), meta: { class: { th: 'w-12', td: 'w-12 text-end' } } },
])

function writeQuery(next: { scope?: HrLeaveScope; offset?: number }) {
  const nextScope = next.scope ?? scope.value
  const nextOffset = next.offset ?? 0
  void router.replace({
    query: {
      ...route.query,
      scope: nextScope === 'mine' ? undefined : nextScope,
      offset: nextOffset > 0 ? nextOffset : undefined,
    },
    hash: route.hash,
  })
}
function setScope(value: string) {
  if (!hydrated.value) return
  writeQuery({ scope: scopeFrom(value), offset: 0 })
}
function setPage(next: number) {
  if (!hydrated.value || requests.isFetching.value || next < 1 || next > pages.value) return
  writeQuery({ offset: (next - 1) * LIMIT })
}

const decisionError = ref('')
// A pending row is withdrawn, a decided one is cancelled; each asks inline before acting.
const withdrawing = ref<HrLeave | null>(null)
const cancelling = ref<HrLeave | null>(null)
const refusing = ref<HrLeave | null>(null)
const writing = computed(() => decision.isPending.value || withdrawal.isPending.value)

async function decide(leave: HrLeave, kind: HrLeaveDecision, reason?: string) {
  if (!hydrated.value || writing.value) return
  decisionError.value = ''
  try {
    await decision.mutateAsync({ id: leave.id, decision: kind, reason })
    cancelling.value = null
    refusing.value = null
  } catch (cause) {
    decisionError.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}

/** A request still waiting for a decision is withdrawn: the server deletes it. */
async function withdraw(leave: HrLeave) {
  if (!hydrated.value || writing.value) return
  decisionError.value = ''
  try {
    await withdrawal.mutateAsync(leave.id)
    withdrawing.value = null
  } catch (cause) {
    decisionError.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}
function rowActions(leave: HrLeave) {
  return [
    ...(canApprove.value && leave.can_approve ? [{ label: t('hr.leave.approve'), icon: 'i-lucide-check' as const, onSelect: () => decide(leave, 'approve') }] : []),
    ...(canApprove.value && leave.can_refuse ? [{ label: t('hr.leave.refuse'), icon: 'i-lucide-x' as const, onSelect: () => { refusing.value = leave } }] : []),
    ...(leave.can_withdraw
      ? [{ label: t('hr.leave.withdraw'), icon: 'i-lucide-undo-2' as const, destructive: true, onSelect: () => { withdrawing.value = leave } }]
      : []),
    ...(leave.can_cancel
      ? [{ label: t('hr.leave.cancel'), icon: 'i-lucide-ban' as const, destructive: true, onSelect: () => { cancelling.value = leave } }]
      : []),
  ]
}

function leaveTo(leave: HrLeave) {
  return { path: `/hr/leave/${leave.id}`, query: returnToQuery(route.fullPath) }
}

const listQuery = computed(() => {
  const { returnTo: _referrer, ...context } = route.query
  return context
})
const createTo = computed(() => canRequest.value ? { path: '/hr/leave/new', query: listQuery.value, ...(route.hash ? { hash: route.hash } : {}) } : undefined)
const allocateTo = computed(() => ({ path: '/hr/leave/allocations/new', query: listQuery.value, ...(route.hash ? { hash: route.hash } : {}) }))
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    :title="t('nav.leave')"
    :tags="countTags"
    :create-to="createTo"
    :create-label="t('hr.leave.new')"
    create-test-id="hr-leave-new"
    kpi-toggle
  >
    <template v-if="canAllocate" #actions>
      <UButton color="neutral" variant="outline" icon="i-lucide-calendar-plus" :to="allocateTo" :disabled="!hydrated" :label="t('hr.leave.allocate')" data-testid="hr-leave-allocate" />
    </template>

    <div class="webvue-page-stack">
      <section :aria-label="t('hr.leave.balancesTitle')" data-testid="hr-leave-balances">
        <!-- Hiding the figures hides the tiles only: a failed balance load still shows its error and retry. -->
        <SharedPageState :loading="kpisShown && balances.isLoading.value" :error="balances.error.value" @retry="balances.refetch">
          <template v-if="kpisShown">
            <div v-if="balanceItems.length" class="grid gap-(--webvue-gap-card) sm:grid-cols-2 xl:grid-cols-3">
              <SharedMetricTile
                v-for="balance in balanceItems"
                :key="balance.leave_type.id"
                density="compact"
                icon="i-lucide-calendar-days"
                :label="balance.leave_type.name"
                :value="n(balance.remaining)"
                :unit="t('hr.leave.remainingUnit')"
                :hint="t('hr.leave.balanceHint', { allocated: n(balance.allocated), taken: n(balance.taken), pending: n(balance.pending) })"
                :tone="balance.remaining > 0 ? 'neutral' : 'warning'"
                :progress="balance.allocated > 0 ? Math.round((balance.remaining / balance.allocated) * 100) : undefined"
              />
            </div>
            <SharedEmptyState v-else bordered :title="t('hr.leave.noBalances')" :description="t('hr.leave.noBalancesHint')" />
          </template>
        </SharedPageState>
      </section>

      <UAlert v-if="decisionError" role="alert" color="error" variant="subtle" :title="decisionError" data-testid="hr-leave-decision-error" />

      <HrLeaveDecisionConfirm v-if="refusing" kind="refuse" :leave="refusing" :pending="writing" @confirm="decide(refusing, 'refuse', $event)" @cancel="refusing = null" />
      <HrLeaveDecisionConfirm v-if="withdrawing" kind="withdraw" :leave="withdrawing" :pending="writing" @confirm="withdraw(withdrawing)" @cancel="withdrawing = null" />
      <HrLeaveDecisionConfirm v-if="cancelling" kind="cancel" :leave="cancelling" :pending="writing" @confirm="decide(cancelling, 'cancel', $event)" @cancel="cancelling = null" />

      <SharedListCard>
        <template v-if="scopeItems.length > 1" #filters>
          <SharedSegmentedControl
            :model-value="scope"
            :items="scopeItems"
            :label="t('hr.leave.scope.label')"
            :disabled="!hydrated"
            @update:model-value="setScope"
          />
        </template>
        <SharedPageState :error="requests.error.value" :keep-content="items.length > 0" @retry="requests.refetch">
          <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t(`hr.leave.empty.${scope}`)" />
          <SharedDataTable
            v-else
            bare
            :rows="items"
            :columns="columns"
            row-key="id"
            :row-to="leaveTo"
            :loading="requests.isLoading.value"
            :caption="t('hr.leave.requestsTitle')"
          >
            <template #id-cell="{ row }"><RecordNumber :value="row.original.id" :data-testid="`hr-leave-row-${row.original.id}`" /></template>
            <template #employee-cell="{ row }"><span class="font-semibold text-highlighted">{{ row.original.employee.name }}</span></template>
            <template #leave_type-cell="{ row }"><NuxtLink :to="leaveTo(row.original)" class="font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" @click="!hydrated && $event.preventDefault()">{{ row.original.leave_type.name }}</NuxtLink></template>
            <template #date_from-cell="{ row }"><bdi>{{ period(row.original) }}</bdi></template>
            <template #number_of_days-cell="{ row }"><span class="tabular-nums">{{ days(row.original.number_of_days) }}</span></template>
            <template #state-cell="{ row }">
              <SharedStatusBadge size="sm" :tone="hrLeaveBadge(row.original.state).tone" :label="t(hrLeaveBadge(row.original.state).labelKey)" data-testid="hr-leave-state" />
            </template>
            <template #actions-cell="{ row }">
              <SharedRowActions
                :actions="rowActions(row.original)"
                :label="t('hr.leave.actionsFor', { type: row.original.leave_type.name })"
                :disabled="writing"
              />
            </template>
            <template #mobile-row="{ row }">
              <div class="flex items-center justify-between gap-2">
                <bdi class="text-xs text-muted">#{{ row.id }}</bdi>
                <SharedStatusBadge size="sm" :tone="hrLeaveBadge(row.state).tone" :label="t(hrLeaveBadge(row.state).labelKey)" />
              </div>
              <p v-if="scope !== 'mine'" class="mt-1 font-semibold text-highlighted">{{ row.employee.name }}</p>
              <p class="mt-1 text-sm"><NuxtLink :to="leaveTo(row)" class="font-semibold text-highlighted hover:underline" @click="!hydrated && $event.preventDefault()">{{ row.leave_type.name }}</NuxtLink> · <span class="tabular-nums">{{ days(row.number_of_days) }}</span></p>
              <bdi class="block text-xs text-muted">{{ period(row) }}</bdi>
              <div class="mt-2 flex justify-end">
                <SharedRowActions :actions="rowActions(row)" :label="t('hr.leave.actionsFor', { type: row.leave_type.name })" :disabled="writing" />
              </div>
            </template>
          </SharedDataTable>
        </SharedPageState>
        <template v-if="requests.data.value && !showEmpty" #footer>
          <SharedListFooter
            :count-label="t('hr.leave.footer', { shown: items.length, total }, total)"
            :page="page"
            :pages="pages"
            :disabled="requests.isFetching.value"
            count-test-id="hr-leave-count"
            @update:page="setPage"
          />
        </template>
      </SharedListCard>
    </div>
  </SharedListPage>
  <NuxtPage />
</template>
