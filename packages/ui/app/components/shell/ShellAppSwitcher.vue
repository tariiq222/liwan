<script setup lang="ts">
// The application block of app mode: the open application's tile and name, and — when the user has other pinned
// applications — a chevron that opens them as a menu, so switching application is one click without leaving the page.
// It replaced a static block plus a duplicated «كل التطبيقات» back row above it: that row stayed in the footer, and
// the block could not do anything. Presentational: the rows arrive from the shell.
/** One row of the switch menu: the application id (for its coloured tile), its name, icon and page. */
export interface ShellAppSwitchItem { id: string, label: string, icon: string, to: string, testId?: string }
const props = withDefaults(defineProps<{
  app: { id?: string, label: string, icon: string }
  /** The applications the user pinned, in rail order. Empty or one leaves the block static. */
  items?: readonly ShellAppSwitchItem[]
  /** Accessible name of the menu trigger (the block's own name is the application's). */
  menuLabel: string
  disabled?: boolean
}>(), { items: () => [], disabled: false })
</script>

<template>
  <UDropdownMenu v-if="props.items.length" :items="[props.items.map(item => ({ label: item.label, icon: item.icon, to: item.to, 'data-testid': item.testId }))]" :disabled="props.disabled" :content="{ align: 'start' }" data-testid="navigation-app-switcher">
    <button type="button" class="liwan-side-appblock" :disabled="props.disabled" :aria-label="`${props.app.label} — ${props.menuLabel}`" :aria-haspopup="'menu'">
      <ShellAppTile :icon="props.app.icon" :app="props.app.id" size="md" />
      <span data-slot="name">{{ props.app.label }}</span>
      <UIcon data-slot="chevron" name="i-lucide-chevrons-up-down" class="size-4 shrink-0 opacity-60" aria-hidden="true" />
    </button>
  </UDropdownMenu>
  <ShellTip v-else :label="props.app.label">
    <div class="liwan-side-appblock" :data-testid="'navigation-app-block'">
      <ShellAppTile :icon="props.app.icon" :app="props.app.id" size="md" />
      <span data-slot="name">{{ props.app.label }}</span>
    </div>
  </ShellTip>
</template>
