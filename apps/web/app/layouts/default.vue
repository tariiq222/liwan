<script setup lang="ts">
import AppDrawer from '@/components/shell/AppDrawer.vue'
import AppSidebar from '@/components/shell/AppSidebar.vue'
import AppTabBar from '@/components/shell/AppTabBar.vue'
import AppTopBar from '@/components/shell/AppTopBar.vue'
import SlideOverHost from '@/components/shell/SlideOverHost.vue'
import { appScopeFor } from '@/utils/appScope'
import { shellBreadcrumb } from '@/composables/nav/breadcrumb'
import { useShellModel } from '@/composables/useShellModel'
import { usePageHeaderTitle } from '@liwan/ui/app/composables/usePageHeader'
import { providePageTrail } from '@liwan/ui/app/composables/usePageTrail'
import { providePageApp } from '@liwan/ui/app/composables/usePageApp'
const route = useRoute()
const { t, te } = useI18n()
const hydrated = useHydrated()
const { rail, activeModule } = useShellModel()
// The phone drawer opens from the tab bar's last tab and holds the sidebar content.
const drawerOpen = ref(false)
const pageTitle = usePageHeaderTitle()
// The trail belongs to the page header (DESIGN.md §3): the shell publishes the ancestors of the
// current route and SharedPageHeader draws them under the page title, so there is one trail, not two. The page
// title arrives after hydration (the page registers it) and the shell names the current page only then, so both
// renders agree.
// The open application's identity (app-identity.css) rides on <html>, so overlays teleported to <body> (slide-overs, modals,
// popovers, menus, toasts) inherit it. An application's settings page takes that application's identity too.
const appScope = computed(() => appScopeFor(route.path, activeModule.value))
useHead(() => ({ htmlAttrs: { 'data-app': appScope.value } }))
const trail = computed(() => shellBreadcrumb({ path: route.path, pageTitle: hydrated.value ? pageTitle.value : null, t, rail: rail.value.all }))
providePageTrail(trail)
// The page header draws the tile and the one-line tagline before its title from the application that owns the
// route; a page no application owns (account, search) gets the generic icon.
providePageApp(() => {
  if (route.path === '/account' || route.path.startsWith('/account/')) return { icon: 'i-lucide-user-round', label: t('nav.account'), to: '/account' }
  const owner = rail.value.all.find(item => item.id === activeModule.value)
  if (!owner) return { icon: 'i-lucide-layout-grid' }
  const taglineKey = `launcher.apps.${owner.id}.description`
  return { icon: owner.icon, id: owner.id, label: t(owner.labelKey), to: owner.to, tagline: te(taglineKey) ? t(taglineKey) : undefined }
})
// The deleted route sheet restored focus when it closed; an ordinary page has
// no such moment, so a keyboard or screen-reader user pressing Escape on a
// record used to land on the list with focus on <body>. Moving focus to the
// main region after each navigation replaces that. Pages are not dialogs, so
// this is a focus move, not a trap, and the first load is left alone.
const shellMain = ref<HTMLElement | null>(null)
// route.path, not fullPath: a same-page filter or tab change must not yank
// focus out of the control the user is currently operating.
watch(() => route.path, () => {
  if (!import.meta.client) return
  // preventScroll leaves Nuxt's own scroll restoration in charge.
  nextTick(() => shellMain.value?.focus({ preventScroll: true }))
})
</script>

<template>
  <ShellFrame>
    <template #sidebar><AppSidebar /></template>
    <template #topbar><AppTopBar /></template>
    <main ref="shellMain" tabindex="-1" data-testid="shell-main" class="liwan-shell-main focus:outline-none">
      <slot />
    </main>
    <template #bottom><AppTabBar v-model:open="drawerOpen" /></template>
    <template #overlay>
      <SlideOverHost />
      <AppDrawer v-model:open="drawerOpen" />
    </template>
  </ShellFrame>
</template>
