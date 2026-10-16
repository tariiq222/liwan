<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()
const { items, rail, activeId } = useAdminNav()
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
  <ShellFrame v-else no-sidebar>
    <template #header>
      <AdminHeader :items="items" :active-id="activeId" />
    </template>
    <template #sidebar>
      <ModuleRail :modules="rail.modules" :utility="rail.utility" :active-id="activeId" home-to="/" />
    </template>
    <main ref="main" tabindex="-1" data-testid="shell-main" class="nasq-shell-main focus:outline-none" :aria-label="t('app.shell.content')">
      <slot />
    </main>
  </ShellFrame>
</template>
