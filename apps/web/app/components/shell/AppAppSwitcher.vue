<script setup lang="ts">
import { useShellModel } from '@/composables/useShellModel'

// The quick app switcher of the top bar: a grid icon that opens a popover of coloured tiles, one for every
// application this user can reach (the permission- and feature-filtered rail, never settings or the day page).
const { t } = useI18n()
const hydrated = useHydrated()
const shell = useShellModel()
const open = ref(false)
const apps = computed(() => [
  ...shell.rail.value.top.filter(item => item.id !== 'home'),
  ...shell.rail.value.first,
  ...shell.rail.value.applications,
  ...shell.rail.value.last,
].map(item => ({ id: item.id, label: t(item.labelKey), icon: item.icon, to: item.to })))
</script>

<template>
  <UPopover v-if="apps.length" v-model:open="open" :content="{ align: 'end', sideOffset: 8 }" :ui="{ content: 'liwan-app-switcher rounded-surface p-0' }">
    <ShellToolButton data-testid="app-switcher" variant="outline" icon="i-lucide-layout-grid" :label="t('nav.appSwitcher')" :open="open" haspopup="dialog" :disabled="!hydrated" />
    <template #content>
      <ShellAppGrid :apps="apps" :label="t('nav.appSwitcher')" @navigate="open = false" />
    </template>
  </UPopover>
</template>
