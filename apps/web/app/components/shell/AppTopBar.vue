<script setup lang="ts">
import AssistantButton from '@/components/shell/AssistantButton.vue'
import GlobalSearch from '@/components/shell/GlobalSearch.vue'
import AppUserMenu from '@/components/shell/AppUserMenu.vue'
import NotificationCenter from '@/components/notifications/NotificationCenter.vue'
import { goKeyTargets } from '@/composables/nav/paletteModel'
import { useNav, type ShellContextLink } from '@/composables/nav/shellModules'
import { pinnedCreateLinks } from '@/composables/nav/sidebarModel'
import { toolBadge } from '@/composables/nav/quickPanelModel'
import { clickPageCreate, createShortcutTarget, focusListSearch } from '@/composables/shortcuts/targets'
import { useAssistantSheet } from '@/composables/useAssistantSheet'
import { useQuickPanels } from '@/composables/useQuickPanels'
import { useShellModel } from '@/composables/useShellModel'
import { slideOverId, useSlideOver } from '@/composables/useSlideOver'
import { useShellShortcuts } from '@/composables/useShellShortcuts'

// The flat 68px top bar, start to end: the ⌘K command palette (which also opens any application), the assistant, a
// divider, the work tools the applications declare (meetings, tasks, chats), a divider, the notifications, and the user
// menu at the far end. It also hosts the shell's one keyboard listener (useShellShortcuts). On a phone the bar shows
// the product mark beside the search icon.
const { t } = useI18n()
const route = useRoute()
const { can } = useAccess()
const { me } = useMe()
const shell = useShellModel()
const slideOver = useSlideOver()
const { tools } = useQuickPanels()
const assistant = useAssistantSheet()
// A divider only stands between two groups that both show: the assistant, the work tools, the notifications.
const toolsDivider = computed(() => assistant.showButton.value && tools.value.length > 0)
const bellDivider = computed(() => (assistant.showButton.value || tools.value.length > 0) && can('liwan.notifications'))
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
      <span v-if="toolsDivider" class="liwan-shell-divider" aria-hidden="true" />
      <div v-if="tools.length" class="liwan-tools" role="group" :aria-label="t('nav.tools')">
        <ShellToolButton
          v-for="tool in tools"
          :key="tool.panel.id"
          :data-testid="`${tool.panel.id}-tool`"
          :icon="tool.panel.icon"
          :label="t(tool.panel.labelKey)"
          :badge="toolBadge(tool.count)"
          :open="slideOver.open.value === tool.panel.id"
          :controls="slideOverId(tool.panel.id)"
          haspopup="dialog"
          hide-on-mobile
          @click="slideOver.toggle(tool.panel.id, $event.currentTarget as HTMLElement)"
        />
      </div>
      <span v-if="bellDivider" class="liwan-shell-divider" aria-hidden="true" />
      <NotificationCenter v-if="can('liwan.notifications')" />
      <AppUserMenu />
    </template>
  </ShellTopBar>
</template>
