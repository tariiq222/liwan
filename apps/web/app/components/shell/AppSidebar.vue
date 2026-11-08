<script setup lang="ts">
import type { ShellNavigationLink, ShellQuickItem } from '@liwan/ui/app/types/shell'
import { useApplicationNavigation } from '@/composables/useApplicationNavigation'
import { useShellModel } from '@/composables/useShellModel'

// The one sidebar. Global mode (the day page, the start pages, search, notifications): the organisation, «يومي» and the
// assistant, the pinned applications, «كل التطبيقات». App mode (an application, settings or the self-service pages): a
// back row to «كل التطبيقات», the application's block, then its own links (create action first, then sections). The
// footer carries settings and the account card in both. `surface="drawer"` is the same content inside the phone drawer.
const props = withDefaults(defineProps<{ surface?: 'sidebar' | 'drawer' }>(), { surface: 'sidebar' })
const emit = defineEmits<{ navigate: [] }>()
const { t, locale } = useI18n()
const route = useRoute()
const hydrated = useHydrated()
const { branding } = useBranding()
const { me } = useMe()
const { connected } = useBus()
const shell = useShellModel()
const navigation = useApplicationNavigation()

const prefix = computed(() => props.surface === 'drawer' ? 'mobile-' : '')
const tenantName = computed(() => branding.value?.name?.trim() || me.value?.company.name || '')
const initial = (text: string) => Array.from(text.trim())[0]?.toLocaleUpperCase() ?? '?'
const onAppsPage = computed(() => route.path === '/apps' || route.path.startsWith('/apps/'))

const link = (id: string, label: string, icon: string, to: string, active: boolean, app?: string): ShellNavigationLink =>
  ({ id, label, icon, to, active, app, testId: `navigation-app-${id}` })
const home = computed(() => shell.rail.value.top.find(item => item.id === 'home'))
const dayRows = computed<ShellNavigationLink[]>(() => [
  ...(home.value ? [link('home', t(home.value.labelKey), home.value.icon, home.value.to, shell.activeModule.value === 'home')] : []),
  ...shell.rail.value.top.filter(item => item.id !== 'home').map(item => link(item.id, t(item.labelKey), item.icon, item.to, shell.activeModule.value === item.id, item.id)),
])
const pinnedRows = computed<ShellNavigationLink[]>(() => shell.pinned.value.map(item => link(item.id, t(item.labelKey), item.icon, item.to, shell.activeModule.value === item.id, item.id)))
const allAppsRows = computed<ShellNavigationLink[]>(() => [link('apps', t('nav.allApps'), 'i-lucide-layout-grid', '/apps', onAppsPage.value)])
const settings = computed(() => shell.rail.value.utility[0])
const settingsRows = computed<ShellNavigationLink[]>(() => settings.value ? [link(settings.value.id, t(settings.value.labelKey), settings.value.icon, settings.value.to, navigation.activeId.value === settings.value.id)] : [])
const backRows = computed<ShellNavigationLink[]>(() => [link('back', t('nav.allApps'), 'i-lucide-arrow-left', '/apps', false)])

// App mode: the create action first, then the application's own sections.
const app = computed(() => navigation.item.value)
const asLink = (row: ShellQuickItem): ShellNavigationLink => ({ ...row, testId: `quick-action-${row.id}` })
const actionRows = computed<ShellNavigationLink[]>(() => (app.value?.actions ?? []).map(asLink))
const sections = computed(() => app.value?.sections ?? [])
// The person's first role names them under their name; a person without one shows the name alone.
const roleName = computed(() => {
  const role = me.value?.roles?.[0]
  return role ? role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar : undefined
})
const accountLabel = computed(() => me.value?.name ? `${t('nav.account')}: ${me.value.name}` : t('nav.account'))
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
    <template v-if="navigation.mode.value === 'global'" #org>
      <ShellOrgCard v-if="tenantName" :name="tenantName" :initial="initial(tenantName)" :logo-url="branding?.logo_url" />
    </template>

    <template v-if="navigation.mode.value === 'global'">
      <ShellNavSection :label="t('nav.day')" :items="dayRows" :test-id-prefix="prefix" :hydrated="hydrated" @navigate="emit('navigate')" />
      <ShellNavSection :label="t('nav.myApps')" :title="t('nav.myApps')" :action="{ label: t('nav.editApps'), to: '/apps' }" :items="pinnedRows" :test-id-prefix="prefix" :hydrated="hydrated" @navigate="emit('navigate')" />
      <ShellNavSection :label="t('nav.allApps')" :items="allAppsRows" :test-id-prefix="prefix" :hydrated="hydrated" @navigate="emit('navigate')" />
    </template>
    <template v-else-if="app">
      <div class="liwan-side-back"><ShellNavSection :label="t('nav.allApps')" :items="backRows" :test-id-prefix="prefix" :hydrated="hydrated" @navigate="emit('navigate')" /></div>
      <div class="liwan-side-appblock" :data-testid="`${prefix}navigation-app-block`">
        <ShellAppTile :icon="app.icon" :app="app.id" size="md" />
        <span data-slot="name">{{ app.label }}</span>
      </div>
      <ShellNavSection v-if="actionRows.length" :label="t('nav.quickActionsList')" :items="actionRows" :test-id-prefix="prefix" :hydrated="hydrated" @navigate="emit('navigate')" />
      <ShellNavSection v-for="section in sections" :key="section.id" :label="app.label" :title="section.title || undefined" :items="section.items" :test-id-prefix="prefix" :hydrated="hydrated" @navigate="emit('navigate')" />
    </template>

    <template #footer>
      <ShellNavSection v-if="settingsRows.length" :label="t('nav.settings')" :items="settingsRows" :test-id-prefix="prefix" :hydrated="hydrated" @navigate="emit('navigate')" />
      <ShellAccountCard
        :name="me?.name ?? ''"
        :initial="initial(me?.name ?? '?')"
        :caption="roleName"
        to="/account"
        :connected="hydrated ? connected : null"
        :label="accountLabel"
        :connected-label="t('bus.connected')"
        :disconnected-label="t('bus.disconnected')"
        :disabled="!hydrated"
      />
    </template>
  </ShellSidebar>
</template>
