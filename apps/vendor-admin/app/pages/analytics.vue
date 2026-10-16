<script setup lang="ts">
import { formatCommercialMoney } from '@nasq/commercial-ui/app/utils/commercial'
import type { RankedRow } from '@/components/analytics/RankedList.vue'
import { usageMetricLabel } from '@/utils/vendorSubscriptions'
import { figureNumber, formatFigure, HEADLINE_IDS, KPIS, periodFromQuery, presetRange, toCsv, type KpiGroup, type PeriodChoice } from '@/utils/vendorAnalytics'
definePageMeta({ capability: 'vendor.billing.manage' })
const { t, te, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const { load } = useVendorAnalytics()

const today = new Date().toISOString().slice(0, 10)
const period = computed(() => periodFromQuery(route.query, today))
const { data, error, pending, refresh } = await useAsyncData(
  'vendor:analytics',
  () => load({ from: period.value.from, to: period.value.to }),
  { watch: [period] },
)
function choose(next: PeriodChoice) {
  const query = next.preset === 'custom' ? { period: 'custom', from: next.from, to: next.to } : { period: next.preset }
  void router.push({ path: route.path, query })
}

const intl = computed(() => (locale.value.startsWith('ar') ? 'ar-SA-u-nu-latn' : 'en-US'))
const kpi = (id: string) => KPIS.find(spec => spec.id === id)!
const label = (id: string) => t(`analytics.kpi.${id}`)
const headline = computed(() => HEADLINE_IDS.map(kpi))
const inGroup = (group: KpiGroup) => KPIS.filter(spec => spec.group === group && !HEADLINE_IDS.includes(spec.id))
const GROUPS: readonly KpiGroup[] = ['revenue', 'collection', 'customers', 'operations']

const money = (minor: number) => (data.value ? formatCommercialMoney({ currency: data.value.currency, exponent: data.value.exponent, minor }, locale.value) : '')
const compact = (minor: number) => new Intl.NumberFormat(intl.value, { style: 'currency', currency: data.value?.currency ?? 'SAR', notation: 'compact', maximumFractionDigits: 1 }).format(minor / 10 ** (data.value?.exponent ?? 2))
const number = (value: number) => new Intl.NumberFormat(intl.value).format(value)
const percent = (value: number) => new Intl.NumberFormat(intl.value, { style: 'percent', maximumFractionDigits: 0 }).format(value)

const trend = computed(() => (data.value?.trend ?? []).map(point => ({
  month: point.month, minor: point.mrr.minor,
  label: new Intl.DateTimeFormat(intl.value, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${point.month}-01T00:00:00Z`)),
})))
const trendHasRevenue = computed(() => trend.value.some(point => point.minor > 0))

const share = (value: number, total: number) => (total > 0 ? value / total : 0)
const aging = computed<RankedRow[]>(() => {
  const c = data.value?.current.collection
  if (!c) return []
  const buckets = [['overdue0to30', c.overdue_0_30, 'warning'], ['overdue31to60', c.overdue_31_60, 'warning'], ['overdue61plus', c.overdue_61_plus, 'error']] as const
  const total = buckets.reduce((sum, [, figure]) => sum + (figureNumber(figure) ?? 0), 0)
  return buckets.map(([id, figure, tone]) => ({ id, label: label(id), value: formatFigure(figure, 'money', locale.value) ?? '', share: share(figureNumber(figure) ?? 0, total), tone }))
})
const states = computed<RankedRow[]>(() => {
  const rows = data.value?.snapshot.states ?? []
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  return rows.map(row => ({ id: row.state, label: t(`analytics.states.${row.state}`), value: number(row.count), share: share(row.count, total) }))
})
const plans = computed<RankedRow[]>(() => {
  const rows = data.value?.snapshot.plans ?? []
  const total = rows.reduce((sum, row) => sum + row.mrr.minor, 0)
  return rows.map(row => ({ id: row.plan_id, label: row.name, value: money(row.mrr.minor), share: share(row.mrr.minor, total), hint: t('analytics.plans.customers', { count: row.customers }, row.customers) }))
})
const planChanges = computed<RankedRow[]>(() => (data.value?.snapshot.plan_changes ?? []).map(change => ({
  id: `${change.from_plan}-${change.to_plan}-${change.direction}`, label: t('analytics.planChanges.move', { from: change.from_plan, to: change.to_plan }),
  value: number(change.count), hint: t(`analytics.planChanges.${change.direction}`),
})))
const usageRows = (rows: NonNullable<typeof data.value>['snapshot']['upsell'], tone: RankedRow['tone']): RankedRow[] => rows.map(row => ({
  id: `${row.customer_id}-${row.metric}`, label: row.customer_name, value: percent(row.ratio), share: row.ratio, tone,
  hint: usageMetricLabel({ key: row.metric, unit: 'count' }, t, te), to: `/customers/${row.customer_id}`,
}))
const upsell = computed(() => usageRows(data.value?.snapshot.upsell ?? [], 'warning'))
const lowUsage = computed(() => usageRows(data.value?.snapshot.low_usage ?? [], 'primary'))
const renewals = computed<RankedRow[]>(() => (data.value?.snapshot.renewals ?? []).map(row => ({
  id: String(row.within_days), label: t('analytics.renewals.within', { days: row.within_days }), value: money(row.value.minor),
  hint: t('analytics.renewals.count', { count: row.count }, row.count),
})))
const stalled = computed<RankedRow[]>(() => (data.value?.snapshot.stalled_fulfillments.items ?? []).map(item => ({
  id: item.order_id, label: item.customer_name, value: t('analytics.stalled.age', { hours: Math.round(item.age_hours) }),
  hint: t(`analytics.fulfillment.${item.fulfillment_state}`), to: `/customers/${item.customer_id}`,
})))

function exportCsv() {
  const current = data.value
  if (!current) return
  const rows = KPIS.map((spec) => {
    const text = (figure: ReturnType<typeof spec.pick>) => formatFigure(figure, spec.format, locale.value) ?? t('analytics.unavailable.short')
    return { section: t(`analytics.groups.${spec.group}`), metric: label(spec.id), current: text(spec.pick(current.current)), previous: text(spec.pick(current.previous)) }
  })
  const header = [t('analytics.csv.section'), t('analytics.csv.metric'), `${t('analytics.csv.current')} ${current.period.from}..${current.period.to}`, `${t('analytics.csv.previous')} ${current.previous_period.from}..${current.previous_period.to}`]
  const url = URL.createObjectURL(new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: `nasq-analytics-${current.period.from}_${current.period.to}.csv` })
  link.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <SharedDashboardPage :title="t('analytics.title')" :description="t('analytics.description')">
    <template #actions>
      <UButton icon="i-lucide-download" variant="outline" color="neutral" :disabled="!data" data-testid="analytics-export" @click="exportCsv">{{ t('analytics.export') }}</UButton>
    </template>
    <template #filters>
      <AnalyticsPeriodBar :model-value="period" @update:model-value="choose" />
    </template>
    <template #metrics>
      <template v-if="data">
        <AnalyticsKpiTile
          v-for="spec in headline" :key="spec.id" :label="label(spec.id)" :icon="spec.icon" :format="spec.format" :direction="spec.direction"
          :current="spec.pick(data.current)" :previous="spec.pick(data.previous)"
        />
      </template>
    </template>

    <div class="grid gap-5 @min-[768px]:col-span-2">
      <SharedPageState :loading="pending && !data" :error="error" @retry="refresh">
        <div v-if="data" class="grid gap-8">
          <p class="text-sm text-muted" data-testid="analytics-disclaimer">{{ t('analytics.disclaimer') }}</p>
          <p class="text-sm text-muted">
            {{ t('analytics.scope', { from: data.period.from, to: data.period.to, previousFrom: data.previous_period.from, previousTo: data.previous_period.to, currency: data.currency }) }}
            <span v-if="data.excluded_subscriptions" class="text-warning">{{ t('analytics.excluded', { count: data.excluded_subscriptions }, data.excluded_subscriptions) }}</span>
          </p>

          <section v-for="group in GROUPS" :key="group" class="grid gap-3" :data-testid="`analytics-${group}`" :aria-labelledby="`analytics-${group}-title`">
            <h2 :id="`analytics-${group}-title`" class="text-lg font-semibold">{{ t(`analytics.groups.${group}`) }}</h2>
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <AnalyticsKpiTile
                v-for="spec in inGroup(group)" :key="spec.id" :label="label(spec.id)" :icon="spec.icon" :format="spec.format" :direction="spec.direction"
                :current="spec.pick(data.current)" :previous="spec.pick(data.previous)"
              />
            </div>
            <div class="@container min-w-0">
              <div class="grid gap-5 @min-[768px]:grid-cols-2">
                <template v-if="group === 'revenue'">
                  <SharedChartPanel class="@min-[768px]:col-span-2" :title="t('analytics.trend.title')" :description="t('analytics.trend.description')" :empty="!trendHasRevenue" :empty-text="t('analytics.trend.empty')">
                    <AnalyticsTrendChart :points="trend" :axis-label="compact" :title="t('analytics.trend.title')" />
                  </SharedChartPanel>
                </template>
                <template v-else-if="group === 'collection'">
                  <SharedChartPanel :title="t('analytics.aging.title')" :description="t('analytics.aging.description')">
                    <AnalyticsRankedList :rows="aging" :empty-text="t('analytics.aging.empty')" />
                  </SharedChartPanel>
                </template>
                <template v-else-if="group === 'customers'">
                  <SharedChartPanel :title="t('analytics.states.title')" :description="t('analytics.states.description')">
                    <AnalyticsRankedList :rows="states" :empty-text="t('analytics.states.empty')" />
                  </SharedChartPanel>
                  <SharedChartPanel :title="t('analytics.plans.title')" :description="t('analytics.plans.description')">
                    <AnalyticsRankedList :rows="plans" :empty-text="t('analytics.plans.empty')" />
                  </SharedChartPanel>
                  <SharedChartPanel class="@min-[768px]:col-span-2" :title="t('analytics.planChanges.title')" :description="t('analytics.planChanges.description')">
                    <AnalyticsRankedList :rows="planChanges" :empty-text="t('analytics.planChanges.empty')" />
                  </SharedChartPanel>
                </template>
                <template v-else>
                  <SharedChartPanel :title="t('analytics.stalled.title', { count: data.snapshot.stalled_fulfillments.count })" :description="t('analytics.stalled.description')">
                    <AnalyticsRankedList :rows="stalled" :empty-text="t('analytics.stalled.empty')" />
                  </SharedChartPanel>
                </template>
              </div>
            </div>
          </section>

          <section class="grid gap-3" data-testid="analytics-opportunities" aria-labelledby="analytics-opportunities-title">
            <h2 id="analytics-opportunities-title" class="text-lg font-semibold">{{ t('analytics.groups.opportunities') }}</h2>
            <div class="@container min-w-0">
              <div class="grid gap-5 @min-[768px]:grid-cols-2">
                <SharedChartPanel :title="t('analytics.upsell.title')" :description="t('analytics.upsell.description')">
                  <AnalyticsRankedList :rows="upsell" :empty-text="t('analytics.upsell.empty')" />
                </SharedChartPanel>
                <SharedChartPanel :title="t('analytics.lowUsage.title')" :description="t('analytics.lowUsage.description')">
                  <AnalyticsRankedList :rows="lowUsage" :empty-text="t('analytics.lowUsage.empty')" />
                </SharedChartPanel>
                <SharedChartPanel class="@min-[768px]:col-span-2" :title="t('analytics.renewals.title')" :description="t('analytics.renewals.description')">
                  <AnalyticsRankedList :rows="renewals" :empty-text="t('analytics.renewals.empty')" />
                </SharedChartPanel>
              </div>
            </div>
          </section>
        </div>
      </SharedPageState>
    </div>
  </SharedDashboardPage>
</template>
