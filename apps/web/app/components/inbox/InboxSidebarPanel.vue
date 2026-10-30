<script setup lang="ts">
import type { ShellSubListSection } from '@liwan/ui/app/types/shell'
import ShellContextSubList from '@liwan/ui/app/components/shell/ShellContextSubList.vue'
import InboxConversationList from '@/components/inbox/InboxConversationList.vue'
import { activeReportTab, isReportsPath, reportTabs, type ReportTabId } from '@/composables/inbox/inboxReportNav'
import { parseInboxListRoute, serializeInboxListRoute, type InboxListRoute } from '@/composables/inbox/inboxListRoute'

// The inbox manifest's context-sidebar panel (AppManifest.sidebarPanel): the conversation list beside the open thread.
// The shell renders it without naming the inbox (R3); the list filters stay in the URL query. On the reports pages the
// conversation list has no meaning, so the panel shows the report sections instead (and the campaign sections on the campaign pages).
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

// On the campaign pages the panel offers the campaigns and the audiences, with a way back to the conversations.
const campaigns = computed(() => /^\/inbox\/campaigns(?:\/|$)/.test(route.path))
const audiences = computed(() => /^\/inbox\/campaigns\/audiences(?:\/|$)/.test(route.path))
const campaignSections = computed<ShellSubListSection[]>(() => [{
  id: 'campaigns',
  title: t('inbox.campaigns.title'),
  items: [
    ...(can('inbox.conversations.read') ? [{ id: 'conversations', label: t('inbox.reports.backToInbox'), icon: 'i-lucide-inbox', to: '/inbox', active: false, testId: 'inbox-campaigns-nav-conversations' }] : []),
    { id: 'list', label: t('inbox.campaigns.title'), icon: 'i-lucide-megaphone', to: '/inbox/campaigns', active: !audiences.value, testId: 'inbox-campaigns-nav-list' },
    { id: 'audiences', label: t('inbox.campaigns.audiences.title'), icon: 'i-lucide-users-round', to: '/inbox/campaigns/audiences', active: audiences.value, testId: 'inbox-campaigns-nav-audiences' },
  ],
}])

function updateRoute(next: InboxListRoute, options?: { replace: boolean }) {
  // A scope, state or page change is a step Back returns to; only a correction of the URL replaces its entry.
  void router[options?.replace ? 'replace' : 'push']({ path: route.path, query: serializeInboxListRoute(next) })
}
</script>

<template>
  <ShellContextSubList v-if="reports" :label="t('inbox.reports.navLabel')" :sections="sections" :collapsed="false" :hydrated="hydrated" />
  <ShellContextSubList v-else-if="campaigns" :label="t('inbox.campaigns.navLabel')" :sections="campaignSections" :collapsed="false" :hydrated="hydrated" />
  <InboxConversationList v-else class="min-h-0 flex-1" :route-state="routeState" :selected-id="selectedId" @update:route-state="updateRoute" />
</template>
