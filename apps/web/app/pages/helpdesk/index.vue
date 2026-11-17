<script setup lang="ts">
import HelpdeskTicketDirectory from '@/components/helpdesk/HelpdeskTicketDirectory.vue'
import { HELPDESK_LIST_KEYS, HELPDESK_LIST_PATH } from '@/composables/helpdesk/helpdeskKeys'
import { listLocation } from '@/composables/useRouteListFilters'
import { useHelpdeskSummary } from '@/composables/helpdesk/useHelpdesk'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'

const { t } = useI18n()
const route = useRoute()
const { can } = useAccess()
const hydrated = useHydrated()
// The counters are an agent's view of the queue; an employee follows their own requests in the list.
const showCounters = computed(() => can('helpdesk.tickets.read'))
const summary = useHelpdeskSummary(showCounters)
const counters = computed<KpiTile[]>(() => {
  const value = summary.data.value
  if (!value) return []
  return [
    { id: 'open', label: t('helpdesk.summary.open'), value: value.open, icon: 'i-lucide-life-buoy', tone: 'neutral', to: HELPDESK_LIST_PATH },
    { id: 'unassigned', label: t('helpdesk.summary.unassigned'), value: value.unassigned, icon: 'i-lucide-user-round-x', tone: value.unassigned ? 'warning' : 'neutral', to: `${HELPDESK_LIST_PATH}?assignee=none` },
    { id: 'mine', label: t('helpdesk.summary.mine'), value: value.mine, icon: 'i-lucide-user-round-check', tone: 'neutral', to: `${HELPDESK_LIST_PATH}?assignee=me` },
    { id: 'overdue', label: t('helpdesk.summary.overdue'), value: value.overdue, icon: 'i-lucide-alarm-clock', tone: value.overdue ? 'danger' : 'success' },
  ]
})
// The create link carries the list's state as its returnTo, so closing the panel returns to the same list.
const createTo = computed(() => (can('helpdesk.tickets.write') || can('helpdesk.requests.create'))
  ? { path: '/helpdesk/new', query: { returnTo: listLocation(HELPDESK_LIST_PATH, HELPDESK_LIST_KEYS, route.query, route.hash) } }
  : undefined)
</script>

<template>
  <SharedListPage :title="t('helpdesk.title')" :description="t('helpdesk.subtitle')" :create-to="createTo" :create-label="t('helpdesk.new')" create-test-id="helpdesk-new">
    <SharedKpiStrip v-if="showCounters && hydrated" :tiles="counters" :loading="summary.isPending.value" :label="t('helpdesk.summary.label')" data-testid="helpdesk-counters" />
    <HelpdeskTicketDirectory />
  </SharedListPage>
</template>
