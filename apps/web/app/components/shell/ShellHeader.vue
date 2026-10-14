<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import AppAccountMenu from '@/components/shell/AppAccountMenu.vue'
import AppearanceMenu from '@/components/shell/AppearanceMenu.vue'
import GlobalSearch from '@/components/shell/GlobalSearch.vue'
import MobileNavigation from '@/components/shell/MobileNavigation.vue'
import ShellBreadcrumb from '@/components/shell/ShellBreadcrumb.vue'
import NotificationCenter from '@/components/notifications/NotificationCenter.vue'
import { shellBreadcrumb } from '@/composables/nav/breadcrumb'
import { goKeyTargets } from '@/composables/nav/paletteModel'
import { useNav, type ShellContextLink } from '@/composables/nav/shellModules'
import { sidebarModel } from '@/composables/nav/sidebarModel'
import { clickPageCreate, createShortcutTarget, focusListSearch } from '@/composables/shortcuts/targets'
import { usePageHeaderTitle } from '@/composables/usePageHeader'
import { useShellModel } from '@/composables/useShellModel'
import { useContextSidebar } from '@/composables/useShellNavigation'
import { useShellShortcuts } from '@/composables/useShellShortcuts'

// The 48px neutral header (spec §5): tenant mark, breadcrumb, the ⌘K command palette,
// appearance, bell, account; a console badge on /vendor/*. It also hosts the shell's
// one keyboard listener (useShellShortcuts).
const { t } = useI18n()
const route = useRoute()
const { branding } = useBranding()
const { can } = useAccess()
const hydrated = useHydrated()
const pageTitle = usePageHeaderTitle()
const { activeModule, rail, homePath, contextTitle, contextLabelKey, contextLinks, panel, createTo } = useShellModel()
const { expanded } = useContextSidebar()
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const brandName = computed(() => branding.value?.name ?? t('app.productName'))
// The page registers its title after the header rendered on the server; show it only once hydrated so both renders match.
const crumbs = computed(() => shellBreadcrumb({ path: route.path, pageTitle: hydrated.value ? pageTitle.value : null, t, rail: rail.value.all }))
const isConsole = computed(() => activeModule.value === 'management')
const mobileOpen = ref(false)
const mobile = computed(() => sidebarModel({ links: contextLinks.value, moduleLabelKey: contextLabelKey.value, path: route.path, panel: null, surface: 'mobile' }))
const mobileCreateLinks = computed(() => mobile.value.createLinks.map(link => ({ ...link, to: createTo(link) })))
const { me } = useMe()
useShellShortcuts({
  'focus-search': () => focusListSearch(document),
  create: () => {
    if (clickPageCreate(document)) return true
    // The links the sidebar (desktop) or drawer (mobile) shows, so `C` matches the hint beside them.
    const model = sidebarModel({
      links: contextLinks.value,
      moduleLabelKey: contextLabelKey.value,
      path: route.path,
      panel: panel.value && isDesktop.value ? { expanded: expanded.value } : null,
      surface: isDesktop.value ? 'desktop' : 'mobile',
    })
    const target = createShortcutTarget(model.createLinks, link => createTo(link as ShellContextLink), route.path)
    if (!target) return false
    void navigateTo(target)
    return true
  },
  go: ({ key }) => {
    const target = goKeyTargets(useNav(me.value)).get(key)
    if (target) void navigateTo(target.to)
    return true
  },
})
</script>

<template>
  <header data-testid="shell-header" class="nasq-shell-header" :aria-label="t('nav.header')">
    <div class="nasq-shell-header-start">
      <MobileNavigation
        v-model:open="mobileOpen"
        :modules="rail.all"
        :active-id="activeModule"
        :title="contextTitle"
        :create-links="mobileCreateLinks"
        :sections="mobile.sections"
      />
      <NuxtLink :to="homePath" class="nasq-shell-brand" :aria-label="`${brandName} — ${t('nav.home')}`">
        <img v-if="branding?.logo_url" :src="branding.logo_url" :alt="brandName" class="nasq-shell-brand-logo">
        <span v-else class="nasq-shell-brand-mark" aria-hidden="true">{{ brandName.slice(0, 1) }}</span>
        <span class="nasq-shell-brand-name">{{ brandName }}</span>
      </NuxtLink>
      <span v-if="crumbs.length" class="nasq-shell-header-divider" aria-hidden="true" />
      <ShellBreadcrumb :items="crumbs" />
      <UBadge v-if="isConsole" color="neutral" variant="subtle" size="sm" class="nasq-shell-console-badge" data-testid="vendor-console-badge">{{ t('nav.consoleBadge') }}</UBadge>
    </div>
    <div class="nasq-shell-header-actions">
      <GlobalSearch />
      <AppearanceMenu />
      <NotificationCenter v-if="can('nasq.notifications')" />
      <AppAccountMenu />
    </div>
  </header>
</template>
