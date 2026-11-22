<script setup lang="ts">
import { tabBarItems } from '@/composables/nav/tabBarModel'
import { toolBadge } from '@/composables/nav/coreApps'
import { useCoreAppCounts } from '@/composables/useCoreAppCounts'
import { useShellModel } from '@/composables/useShellModel'

// The phone's bottom navigation: today, my tasks, conversations, the assistant, and «المزيد», which opens the drawer.
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const hydrated = useHydrated()
const shell = useShellModel()
// The same counts the sidebar's core-app row carries: on a phone those tiles are inside the drawer, so a
// conversation or an open task would otherwise have no visible number anywhere on the page.
const counts = useCoreAppCounts()
const items = computed(() => tabBarItems({
  rail: shell.rail.value.all,
  activeModule: shell.activeModule.value,
  moreOpen: open.value,
  translate: key => t(key),
  moreLabel: t('nav.more'),
  badges: Object.fromEntries(Object.entries(counts.value).map(([id, count]) => [id, toolBadge(count)])),
}))
</script>

<template>
  <ShellTabBar :items="items" :label="t('nav.tabBar')" :disabled="!hydrated" @press="open = !open" />
</template>
