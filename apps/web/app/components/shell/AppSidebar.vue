<script setup lang="ts">
import type { ShellFooterTool, ShellNavigationLink, ShellQuickItem } from '@liwan/ui/app/types/shell'
import { useApplicationNavigation } from '@/composables/useApplicationNavigation'
import { useCoreApps } from '@/composables/useCoreApps'
import { useShellModel } from '@/composables/useShellModel'

// The one sidebar. Under the brand, in both modes, the organisation card and the icon row of the core applications
// (يومي، Liwan AI، أعمالي، المحادثات), each opening its own page. Global mode (the day page, the start pages, search,
// notifications) then lists the pinned applications. App mode (an application, settings or the self-service pages):
// the application switcher block (listing Meetings first, Documents and Operations, then the remaining pinned
// applications), then its own links (create action first, then sections). The footer is one icon row (the documents,
// the operations, «كل التطبيقات», the settings, the support button and a chevron that opens the same four as a list)
// in both; the account is in the top bar. `surface="drawer"` is the same content inside the phone drawer.
const props = withDefaults(defineProps<{ surface?: 'sidebar' | 'drawer' }>(), { surface: 'sidebar' })
const emit = defineEmits<{ navigate: [] }>()
const { t } = useI18n()
const route = useRoute()
const hydrated = useHydrated()
const { branding } = useBranding()
const { me } = useMe()
const shell = useShellModel()
const navigation = useApplicationNavigation()
const coreItems = useCoreApps()

const prefix = computed(() => props.surface === 'drawer' ? 'mobile-' : '')
// A person who can work in several companies of the tenant always sees which one the next save goes to: the card
// names the working company then. With one company it names the tenant (its branding), as before.
const tenantName = computed(() => (me.value?.companies.length ?? 0) > 1
  ? me.value!.company.name
  : branding.value?.name?.trim() || me.value?.company.name || '')
const initial = (text: string) => Array.from(text.trim())[0]?.toLocaleUpperCase() ?? '?'
const onAppsPage = computed(() => route.path === '/apps' || route.path.startsWith('/apps/'))

const link = (id: string, label: string, icon: string, to: string, active: boolean, app?: string): ShellNavigationLink =>
  ({ id, label, icon, to, active, app, testId: `navigation-app-${id}` })
const pinnedRows = computed<ShellNavigationLink[]>(() => shell.pinned.value.map(item => link(item.id, t(item.labelKey), item.icon, item.to, shell.activeModule.value === item.id, item.id)))
const settings = computed(() => shell.rail.value.utility[0])
// The footer: the base applications (documents, operations), «كل التطبيقات» and the settings (opening it enters the
// settings application's own menu).
const footerRows = computed<ShellNavigationLink[]>(() => [
  ...shell.rail.value.footer.map(item => link(item.id, t(item.labelKey), item.icon, item.to, shell.activeModule.value === item.id)),
  link('apps', t('nav.allApps'), 'i-lucide-layout-grid', '/apps', onAppsPage.value),
  ...(settings.value ? [link(settings.value.id, t(settings.value.labelKey), settings.value.icon, settings.value.to, navigation.activeId.value === settings.value.id)] : []),
])
// The footer shows as one row of icons: the same four destinations, then the support button (no page yet), and a chevron
// that opens the vertical list above.
const footerOpen = ref(false)
const footerTools = computed<ShellFooterTool[]>(() => [
  ...footerRows.value,
  { id: 'support', label: t('nav.supportSoon'), icon: 'i-lucide-life-buoy', disabled: true },
])
const footerSwitchRows = computed<ShellNavigationLink[]>(() =>
  shell.rail.value.footer.map(item => link(item.id, t(item.labelKey), item.icon, item.to, shell.activeModule.value === item.id, item.id)),
)
// Every switchable application except the open one: Meetings first, then Documents and Operations, then the remaining pinned applications (owner decision 2026-11-25).
const switchItems = computed(() => {
  const seen = new Set<string>()
  const add = (rows: readonly ShellNavigationLink[]) => rows.filter((row) => {
    if (row.id === shell.activeModule.value || seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
  const meetingsItem = shell.rail.value.applications.find(item => item.id === 'meetings')
  const meetingsRow = meetingsItem ? [link(meetingsItem.id, t(meetingsItem.labelKey), meetingsItem.icon, meetingsItem.to, shell.activeModule.value === meetingsItem.id, meetingsItem.id)] : []
  return [...add(meetingsRow), ...add(footerSwitchRows.value), ...add(pinnedRows.value)]
})

// App mode: the create action first, then the application's own sections.
const app = computed(() => navigation.item.value)
const asLink = (row: ShellQuickItem): ShellNavigationLink => ({ ...row, testId: `quick-action-${row.id}` })
const actionRows = computed<ShellNavigationLink[]>(() => (app.value?.actions ?? []).map(asLink))
const sections = computed(() => app.value?.sections ?? [])
</script>

<template>
  <ShellSidebar
    :label="t('nav.sidebar')"
    :brand-name="t('nav.platformName')"
    :caption="t('nav.platformCaption')"
    :home-to="shell.homePath.value"
    :surface="props.surface"
    :mode="navigation.mode.value"
    :test-id-prefix="prefix"
  >
    <template #org>
      <ShellOrgCard v-if="tenantName" :name="tenantName" :initial="initial(tenantName)" :logo-url="branding?.logo_url" />
    </template>

    <template #core>
      <ShellCoreApps :label="t('nav.coreApps')" :items="coreItems" :test-id-prefix="prefix" @navigate="emit('navigate')" />
    </template>

    <ShellNavSection v-if="navigation.mode.value === 'global'" :label="t('nav.myApps')" :title="t('nav.myApps')" :action="{ label: t('nav.editApps'), to: '/apps', icon: 'i-lucide-pencil' }" :items="pinnedRows" :test-id-prefix="prefix" :hydrated="hydrated" @navigate="emit('navigate')" />
    <template v-else-if="app">
      <!-- The block switches application directly (DESIGN.md §3): the «كل التطبيقات» row that used to sit above it
           pointed at /apps, which the footer already carries, so the same link appeared twice in one column. -->
      <ShellAppSwitcher :app="{ id: app.id, label: app.label, icon: app.icon }" :items="switchItems" :menu-label="t('nav.switchApp')" :disabled="!hydrated" :test-id-prefix="prefix" />
      <ShellNavSection v-if="actionRows.length" :label="t('nav.quickActionsList')" :items="actionRows" :test-id-prefix="prefix" :hydrated="hydrated" @navigate="emit('navigate')" />
      <ShellNavSection v-for="section in sections" :key="section.id" :label="app.label" :title="section.title || undefined" :items="section.items" :test-id-prefix="prefix" :hydrated="hydrated" @navigate="emit('navigate')" />
    </template>

    <template #footer>
      <ShellFooterBar
        v-model:expanded="footerOpen"
        :label="t('nav.footerShortcuts')"
        :tools="footerTools"
        :expand-label="t('nav.footerExpand')"
        :collapse-label="t('nav.footerCollapse')"
        :test-id-prefix="prefix"
        :hydrated="hydrated"
        @navigate="emit('navigate')"
      >
        <ShellNavSection :label="t('nav.footer')" :items="footerRows" :test-id-prefix="prefix" :hydrated="hydrated" @navigate="emit('navigate')" />
      </ShellFooterBar>
    </template>
  </ShellSidebar>
</template>
