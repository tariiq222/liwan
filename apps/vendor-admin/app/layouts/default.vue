<script setup lang="ts">
import type { ShellNavigationLink, ShellRailItem } from '@liwan/ui/app/types/shell'
const route = useRoute()
const { t } = useI18n()
const { items, rail, activeId } = useAdminNav()
// The sidebar rows of one rail group; the open section carries the ring.
const rows = (group: ShellRailItem[]): ShellNavigationLink[] => group.map(item => ({ id: item.id, label: t(item.labelKey), icon: item.icon, to: item.to, active: item.id === activeId.value, testId: `nav-${item.id}` }))
// Public pages (sign-in, enrollment) have no console around them.
const bare = computed(() => route.meta.public === true)
await settleSession(useAdminSession().ready, bare.value)

// A page is not a dialog, so moving focus to the main region after a navigation is a focus move,
// not a trap; the first load is left alone. route.path, not fullPath: a filter or tab change must
// not pull focus out of the control being used.
const main = ref<HTMLElement | null>(null)
watch(() => route.path, () => {
  if (!import.meta.client) return
  void nextTick(() => main.value?.focus({ preventScroll: true }))
})
</script>

<template>
  <slot v-if="bare" />
  <ShellFrame v-else>
    <template #sidebar>
      <ShellSidebar :label="t('app.shell.navigation')" :brand-name="t('brand.name')" home-to="/" mode="app">
        <ShellNavSection :label="t('app.shell.navigation')" :items="rows(rail.applications)" />
        <ShellNavSection v-if="rail.utility.length" :label="t('app.shell.navigation')" :items="rows(rail.utility)" />
      </ShellSidebar>
    </template>
    <template #topbar>
      <AdminHeader :items="items" :active-id="activeId" />
    </template>
    <main ref="main" tabindex="-1" data-testid="shell-main" class="liwan-shell-main focus:outline-none" :aria-label="t('app.shell.content')">
      <slot />
    </main>
  </ShellFrame>
</template>
