<script setup lang="ts">
import type { InboxRef } from '@webvue/contracts'
import { inboxReportRangeDays } from '@webvue/contracts'
import { DEFAULT_REPORT_PERIOD, reportRange, type InboxReportRoute, type ReportPeriod } from '@/composables/inbox/inboxReportRoute'

// The report filters: a quick period (7/30/90 days) or a custom date pair, then the channel, department and agent. The
// parent keeps them in the URL query; this component only reads the route state and emits the next one.
const props = withDefaults(defineProps<{
  route: InboxReportRoute
  channels?: readonly InboxRef[]
  departments?: readonly InboxRef[]
  agents?: readonly InboxRef[]
  /** The longest range one request may cover, in days. */
  maxDays?: number
  /** Offer the custom date pair beside the quick periods. */
  custom?: boolean
  /** A channel must be chosen (template analytics is per channel): no "all channels" entry. */
  channelRequired?: boolean
  disabled?: boolean
}>(), { channels: undefined, departments: undefined, agents: undefined, maxDays: 366, custom: true, channelRequired: false, disabled: false })
const emit = defineEmits<{ 'update:route': [route: InboxReportRoute] }>()
const { t } = useI18n()
const ALL = 'all'

const range = computed(() => reportRange(props.route))
const draftFrom = ref(range.value.from)
const draftTo = ref(range.value.to)
watch(range, (value) => { draftFrom.value = value.from; draftTo.value = value.to })
const draftDays = computed(() => draftFrom.value && draftTo.value ? inboxReportRangeDays(draftFrom.value, draftTo.value) : 0)
const draftValid = computed(() => draftDays.value >= 1 && draftDays.value <= props.maxDays)
const showError = computed(() => props.route.period === 'custom' && !!draftFrom.value && !!draftTo.value && !draftValid.value)

const periodItems = computed(() => [
  ...(['7', '30', '90'] as const).filter(value => Number(value) <= props.maxDays).map(value => ({ value, label: t(`inbox.reports.period.d${value}`) })),
  ...(props.custom ? [{ value: 'custom', label: t('inbox.reports.period.custom') }] : []),
])
const options = (items: readonly InboxRef[] | undefined, all: string) => [{ value: ALL, label: all }, ...(items ?? []).map(item => ({ value: String(item.id), label: item.name }))]
const channelItems = computed(() => props.channelRequired ? options(props.channels, '').slice(1) : options(props.channels, t('inbox.reports.filters.allChannels')))
const departmentItems = computed(() => options(props.departments, t('inbox.reports.filters.allDepartments')))
const agentItems = computed(() => options(props.agents, t('inbox.reports.filters.allAgents')))

const activeCount = computed(() => Number(props.route.period !== DEFAULT_REPORT_PERIOD) + Number(!!props.route.channelId && !props.channelRequired) + Number(!!props.route.departmentId) + Number(!!props.route.agentId))
const next = (patch: Partial<InboxReportRoute>) => emit('update:route', { ...props.route, ...patch })
const idOf = (value: unknown) => (value === ALL || value === undefined ? null : Number(value))

function pickPeriod(value: string) {
  if (value === 'custom') next({ period: 'custom', from: range.value.from, to: range.value.to })
  else next({ period: value as ReportPeriod, from: '', to: '' })
}
function pickDate(edge: 'from' | 'to', value: string | null) {
  if (edge === 'from') draftFrom.value = value ?? ''
  else draftTo.value = value ?? ''
  if (draftValid.value) next({ period: 'custom', from: draftFrom.value, to: draftTo.value })
}
function clear() {
  emit('update:route', { period: DEFAULT_REPORT_PERIOD, from: '', to: '', channelId: null, departmentId: null, agentId: null })
}
</script>

<template>
  <div class="min-w-0">
    <SharedFilterBar embedded class="w-full" :title="t('inbox.reports.filters.title')" :clear-label="t('inbox.reports.filters.clear')" :active-count="activeCount" :disabled="props.disabled" @clear="clear">
      <SharedFilterField :label="t('inbox.reports.period.label')">
        <SharedSegmentedControl :label="t('inbox.reports.period.label')" :items="periodItems" :model-value="props.route.period" :disabled="props.disabled" data-testid="inbox-report-period" @update:model-value="pickPeriod" />
      </SharedFilterField>
      <template v-if="props.route.period === 'custom'">
        <SharedFilterField :label="t('inbox.reports.period.from')">
          <SharedDateField :model-value="draftFrom || null" :aria-label="t('inbox.reports.period.from')" :max-value="draftTo || null" :disabled="props.disabled" data-testid="inbox-report-from" @update:model-value="pickDate('from', $event)" />
        </SharedFilterField>
        <SharedFilterField :label="t('inbox.reports.period.to')">
          <SharedDateField :model-value="draftTo || null" :aria-label="t('inbox.reports.period.to')" :min-value="draftFrom || null" :disabled="props.disabled" data-testid="inbox-report-to" @update:model-value="pickDate('to', $event)" />
        </SharedFilterField>
      </template>
      <USelect v-if="props.channels" :model-value="props.route.channelId ? String(props.route.channelId) : ALL" :items="channelItems" :aria-label="t('inbox.reports.filters.channel')" :disabled="props.disabled" data-testid="inbox-report-channel" @update:model-value="next({ channelId: idOf($event) })" />
      <USelect v-if="props.departments" :model-value="props.route.departmentId ? String(props.route.departmentId) : ALL" :items="departmentItems" :aria-label="t('inbox.reports.filters.department')" :disabled="props.disabled" data-testid="inbox-report-department" @update:model-value="next({ departmentId: idOf($event) })" />
      <USelect v-if="props.agents" :model-value="props.route.agentId ? String(props.route.agentId) : ALL" :items="agentItems" :aria-label="t('inbox.reports.filters.agent')" :disabled="props.disabled" data-testid="inbox-report-agent" @update:model-value="next({ agentId: idOf($event) })" />
    </SharedFilterBar>
    <p v-if="showError" role="alert" class="mt-2 text-sm text-error" data-testid="inbox-report-range-error">{{ t('inbox.reports.period.invalid', { max: props.maxDays }) }}</p>
  </div>
</template>
