<script setup lang="ts">
import AssistantButton from '@/components/shell/AssistantButton.vue'
import GlobalSearch from '@/components/shell/GlobalSearch.vue'
import AppUserMenu from '@/components/shell/AppUserMenu.vue'
import NotificationCenter from '@/components/notifications/NotificationCenter.vue'
import { goKeyTargets } from '@/composables/nav/paletteModel'
import { useNav, type ShellContextLink } from '@/composables/nav/shellModules'
import { pinnedCreateLinks } from '@/composables/nav/sidebarModel'
import { clickPageCreate, createShortcutTarget, focusListSearch } from '@/composables/shortcuts/targets'
import { useAssistantSheet } from '@/composables/useAssistantSheet'
import { useShellModel } from '@/composables/useShellModel'
import { useShellShortcuts } from '@/composables/useShellShortcuts'

// The flat 68px top bar, start to end: the ⌘K command palette (which also opens any application), the assistant, the
// notifications, and the user menu at the far end. It also hosts the shell's one keyboard listener
// (useShellShortcuts). On a phone the bar shows the product mark beside the search icon.
// The application tool panels left this bar (DESIGN.md §3, 2026-11-21): the sidebar's core-app row and the phone tab
// bar already open those pages and carry their numbers, so a second button with the same icon and count read as two.
const { t } = useI18n()
const route = useRoute()
const { can } = useAccess()
const { me } = useMe()
const shell = useShellModel()
const assistant = useAssistantSheet()

useShellShortcuts({
  'focus-search': () => focusListSearch(document),
  create: () => {
    if (clickPageCreate(document)) return true
    // The create links the sidebar lists first, so `C` matches what the person sees.
    const createLinks = pinnedCreateLinks(shell.contextLinks.value, route.path)
    const target = createShortcutTarget(createLinks, link => shell.createTo(link as ShellContextLink), route.path)
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
  <ShellTopBar :label="t('nav.header')">
    <template #start>
      <NuxtLink :to="shell.homePath.value" class="liwan-shell-mark" :aria-label="`${t('nav.platformName')}: ${t('nav.home')}`">
        <SharedBrandWordmark size="md" mark-only />
        <span>{{ t('nav.platformName') }}</span>
      </NuxtLink>
    </template>
    <template #search><GlobalSearch /></template>
    <template #end>
      <AssistantButton />
      <div v-if="can('liwan.notifications')" class="liwan-tools" role="group" :aria-label="t('nav.tools')">
        <NotificationCenter />
      </div>
      <AppUserMenu />
    </template>
  </ShellTopBar>
</template>
