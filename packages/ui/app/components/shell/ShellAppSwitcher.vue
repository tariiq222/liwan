<script setup lang="ts">
import type { ShellAppSwitchItem } from '../../types/shell'

// The application block of app mode: the open application's tile and name, and — when the user has other pinned
// applications — a chevron that opens them as a menu, so switching application is one click without leaving the page.
// It replaced a static block plus a duplicated «كل التطبيقات» back row above it: that row stayed in the footer, and
// the block could not do anything. Presentational: the rows arrive from the shell.
const props = withDefaults(defineProps<{
  app: { id?: string, label: string, icon: string }
  /** The applications the user pinned, in rail order. Empty or one leaves the block static. */
  items?: readonly ShellAppSwitchItem[]
  /** Accessible name of the menu trigger (the block's own name is the application's). */
  menuLabel: string
  disabled?: boolean
  /** The surface's prefix, so the drawer copy and the column never share a test id (`mobile-` inside the drawer). */
  testIdPrefix?: string
}>(), { items: () => [], disabled: false, testIdPrefix: '' })

const menuItems = computed(() => [
  props.items.map(item => ({
    label: item.label,
    to: item.to,
    appId: item.id,
    appIcon: item.icon,
    'data-testid': item.testId,
  })),
])
</script>

<template>
  <UDropdownMenu
    v-if="props.items.length"
    :items="menuItems"
    :disabled="props.disabled"
    :content="{ align: 'start', sideOffset: 6 }"
    :ui="{ content: 'w-(--reka-dropdown-menu-trigger-width) min-w-52 p-1.5', item: 'gap-2.5 rounded-inner px-2 py-1.5 font-medium' }"
    :data-testid="`${props.testIdPrefix}navigation-app-switcher`"
  >
    <button type="button" class="liwan-side-appblock" :disabled="props.disabled" :aria-label="`${props.app.label} — ${props.menuLabel}`" :aria-haspopup="'menu'" :data-testid="`${props.testIdPrefix}navigation-app-block`">
      <ShellAppTile :icon="props.app.icon" :app="props.app.id" size="md" />
      <span data-slot="name">{{ props.app.label }}</span>
      <UIcon data-slot="chevron" name="i-lucide-chevrons-up-down" class="size-4 shrink-0 opacity-60" aria-hidden="true" />
    </button>
    <template #item-leading="{ item }">
      <ShellAppTile :icon="item.appIcon" :app="item.appId" size="sm" />
    </template>
  </UDropdownMenu>
  <ShellTip v-else :label="props.app.label">
    <div class="liwan-side-appblock" :data-testid="`${props.testIdPrefix}navigation-app-block`">
      <ShellAppTile :icon="props.app.icon" :app="props.app.id" size="md" />
      <span data-slot="name">{{ props.app.label }}</span>
    </div>
  </ShellTip>
</template>
