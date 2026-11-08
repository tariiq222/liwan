<script setup lang="ts">
import { tabBarItems } from '@/composables/nav/tabBarModel'
import { useShellModel } from '@/composables/useShellModel'

// The phone's bottom navigation: today, my tasks, conversations, the assistant, and «المزيد», which opens the drawer.
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const hydrated = useHydrated()
const shell = useShellModel()
const items = computed(() => tabBarItems({
  rail: shell.rail.value.all,
  activeModule: shell.activeModule.value,
  moreOpen: open.value,
  translate: key => t(key),
  moreLabel: t('nav.more'),
}))
</script>

<template>
  <ShellTabBar :items="items" :label="t('nav.tabBar')" :disabled="!hydrated" @press="open = !open" />
</template>
