<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import AppAccountMenu from '@/components/shell/AppAccountMenu.vue'
import GlobalSearch from '@/components/shell/GlobalSearch.vue'
import MobileNavigation from '@/components/shell/MobileNavigation.vue'
import ShellBreadcrumb from '@nasq/ui/app/components/shell/ShellBreadcrumb.vue'
import NotificationCenter from '@/components/notifications/NotificationCenter.vue'
import { shellBreadcrumb } from '@/composables/nav/breadcrumb'
import { goKeyTargets } from '@/composables/nav/paletteModel'
import { useNav, type ShellContextLink } from '@/composables/nav/shellModules'
import { sidebarModel } from '@/composables/nav/sidebarModel'
import { clickPageCreate, createShortcutTarget, focusListSearch } from '@/composables/shortcuts/targets'
import { usePageHeaderTitle } from '@nasq/ui/app/composables/usePageHeader'
import { useShellModel } from '@/composables/useShellModel'
import { useContextSidebar } from '@/composables/useShellNavigation'
import { useShellShortcuts } from '@/composables/useShellShortcuts'

// The 48px neutral header (spec §5): tenant mark, breadcrumb, the ⌘K command palette,
// bell, account (which also holds language and appearance).
// It also hosts the shell's one keyboard listener (useShellShortcuts).
const { t } = useI18n()
const route = useRoute()
const { branding } = useBranding()
const { can } = useAccess()
const hydrated = useHydrated()
const pageTitle = usePageHeaderTitle()
const { activeModule, rail, homePath, contextTitle, contextLabelKey, contextLinks, panel, createTo } = useShellModel()
const { expanded } = useContextSidebar()
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
// The tenant's own mark: its logo, else its initials on the primary colour. A tenant without a
// name or logo shows nothing here, because the rail already carries the Nasq wordmark.
const tenantName = computed(() => branding.value?.name?.trim() ?? '')
const tenantInitials = computed(() => tenantName.value.split(/\s+/).filter(Boolean).slice(0, 2).map(word => Array.from(word)[0]!).join('').toLocaleUpperCase())
const showTenantMark = computed(() => !!branding.value?.logo_url || !!tenantName.value)
// The page registers its title after the header rendered on the server; show it only once hydrated so both renders match.
const crumbs = computed(() => shellBreadcrumb({ path: route.path, pageTitle: hydrated.value ? pageTitle.value : null, t, rail: rail.value.all }))
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
      <NuxtLink v-if="showTenantMark" :to="homePath" class="nasq-shell-brand" :aria-label="`${tenantName || t('app.productName')} — ${t('nav.home')}`">
        <img v-if="branding?.logo_url" :src="branding.logo_url" alt="" class="nasq-shell-brand-logo">
        <span v-else class="nasq-shell-brand-mark bg-primary! text-inverted!" aria-hidden="true">{{ tenantInitials }}</span>
        <span v-if="tenantName" class="nasq-shell-brand-name">{{ tenantName }}</span>
      </NuxtLink>
      <span v-if="showTenantMark && crumbs.length" class="nasq-shell-header-divider" aria-hidden="true" />
      <ShellBreadcrumb :items="crumbs" />
    </div>
    <div class="nasq-shell-header-actions">
      <GlobalSearch />
      <NotificationCenter v-if="can('nasq.notifications')" />
      <AppAccountMenu />
    </div>
  </header>
</template>
