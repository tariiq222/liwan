<script setup lang="ts">
import type { ShellSubListSection } from '@webvue/ui/app/types/shell'
import ShellContextSubList from '@webvue/ui/app/components/shell/ShellContextSubList.vue'
import InboxConversationList from '@/components/inbox/InboxConversationList.vue'
import { activeReportTab, isReportsPath, reportTabs, type ReportTabId } from '@/composables/inbox/inboxReportNav'
import { parseInboxListRoute, serializeInboxListRoute, type InboxListRoute } from '@/composables/inbox/inboxListRoute'

// The inbox manifest's context-sidebar panel (AppManifest.sidebarPanel): the conversation list beside the open thread.
// The shell renders it without naming the inbox (R3); the list filters stay in the URL query. On the reports pages the
// conversation list has no meaning, so the panel shows the report sections instead.
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const reports = computed(() => isReportsPath(route.path))
const routeState = computed(() => parseInboxListRoute(route.query))
const selectedId = computed(() => {
  const id = Number(route.path.match(/^\/inbox\/(\d+)(?:\/|$)/)?.[1])
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
})

const TAB_ICON: Record<ReportTabId, string> = { overview: 'i-lucide-chart-column', costs: 'i-lucide-wallet', templates: 'i-lucide-file-text' }
const sections = computed<ShellSubListSection[]>(() => [{
  id: 'reports',
  title: t('inbox.reports.title'),
  items: [
    ...(can('inbox.conversations.read') ? [{ id: 'conversations', label: t('inbox.reports.backToInbox'), icon: 'i-lucide-inbox', to: '/inbox', active: false, testId: 'inbox-reports-nav-conversations' }] : []),
    ...reportTabs(route.path, {}).map(tab => ({
      id: tab.id, label: t(`inbox.reports.tabs.${tab.id}`), icon: TAB_ICON[tab.id], to: tab.to, active: tab.id === activeReportTab(route.path), testId: `inbox-reports-nav-${tab.id}`,
    })),
  ],
}])

function updateRoute(next: InboxListRoute) {
  void router.replace({ path: route.path, query: serializeInboxListRoute(next) })
}
</script>

<template>
  <ShellContextSubList v-if="reports" :label="t('inbox.reports.navLabel')" :sections="sections" :collapsed="false" :hydrated="hydrated" />
  <InboxConversationList v-else class="min-h-0 flex-1" :route-state="routeState" :selected-id="selectedId" @update:route-state="updateRoute" />
</template>
