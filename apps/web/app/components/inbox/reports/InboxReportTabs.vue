<script setup lang="ts">
import { reportTabs } from '@/composables/inbox/inboxReportNav'

// The route tabs of the inbox reports: overview, costs and template analytics. The period and channel stay in the address
// when switching; the department and agent filters only mean something on the overview.
const route = useRoute()
const { t } = useI18n()
const items = computed(() => reportTabs(route.path, route.query).map(tab => ({
  key: `inbox-report-tab-${tab.id}`, label: t(`inbox.reports.tabs.${tab.id}`), to: tab.to, active: tab.active,
})))
</script>

<template>
  <SharedRouteTabs :items="items" :ariaLabel="t('inbox.reports.navLabel')" />
</template>
