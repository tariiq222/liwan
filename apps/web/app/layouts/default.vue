<script setup lang="ts">
import NotificationCenter from '@/components/notifications/NotificationCenter.vue'
import AppAccountMenu from '@/components/AppAccountMenu.vue'
import GlobalSearch from '@/components/GlobalSearch.vue'
import { isNavPathActive, NOTIFICATION_ACCESS } from '@/utils/accessPolicy'

const route = useRoute()
const { can } = useAccess()
const { me } = useMe()
const { t, localeProperties } = useI18n()
const hydrated = useHydrated()
const pageHeader = useShellPageHeader()
const visibleNav = computed(() => useNav(me.value))

const fallbackLabels: Array<[RegExp, string]> = [
  [/^\/projects(?:\/|$)/, 'nav.projects'],
  [/^\/(?:archived-)?tasks(?:\/|$)/, 'nav.tasks'],
  [/^\/hr\/departments(?:\/|$)/, 'nav.departments'],
  [/^\/hr\/documents(?:\/|$)/, 'nav.documents'],
  [/^\/hr(?:\/|$)/, 'nav.employees'],
  [/^\/settings\/users(?:\/|$)/, 'nav.users'],
  [/^\/settings\/roles(?:\/|$)/, 'nav.roles'],
  [/^\/settings\/access-log(?:\/|$)/, 'nav.accessLog'],
  [/^\/settings\/projects(?:\/|$)/, 'nav.projectSettings'],
  [/^\/settings\/branding(?:\/|$)/, 'nav.branding'],
  [/^\/settings\/appearance(?:\/|$)/, 'settings.appearance.title'],
  [/^\/account(?:\/|$)/, 'nav.account'],
  [/^\/search(?:\/|$)/, 'app.search'],
  [/^\/notifications(?:\/|$)/, 'notifications.title'],
  [/^\/reports(?:\/|$)/, 'pages.reports'],
]

const fallbackTitle = computed(() => {
  const activeItem = visibleNav.value
    .filter(item => isNavPathActive(route.path, item.to))
    .sort((a, b) => b.to.length - a.to.length)[0]
  const labelKey = activeItem?.labelKey ?? fallbackLabels.find(([pattern]) => pattern.test(route.path))?.[1]
  return labelKey ? t(labelKey) : t('app.productName')
})
const shellTitle = computed(() => hydrated.value ? pageHeader.title.value?.trim() || fallbackTitle.value : fallbackTitle.value)

// The toaster was hardcoded to rtl, so an `en` user got right-anchored toasts
// with mirrored padding. Follow the active locale's direction instead.
const dir = computed(() => localeProperties.value.dir ?? 'ltr')
</script>

<template>
  <SidebarProvider data-nasq-shell>
    <AppSidebar />
    <SidebarInset>
      <header class="nasq-app-header">
        <div class="nasq-header-start">
          <SidebarTrigger />
          <div class="nasq-header-context">
            <h1 class="nasq-header-title">{{ shellTitle }}</h1>
          </div>
        </div>

        <GlobalSearch />

        <div class="nasq-header-end">
          <NotificationCenter v-if="can(NOTIFICATION_ACCESS)" />
          <AppAccountMenu />
        </div>
      </header>
      <main class="nasq-shell-content">
        <slot />
      </main>
    </SidebarInset>

    <Toaster :dir="dir" />
  </SidebarProvider>
</template>
