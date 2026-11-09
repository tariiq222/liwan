<script setup lang="ts">
// The application frame: a fixed sidebar on the inline-start side, and beside it the workspace column holding the
// sticky top bar and the page. The bottom tab bar and the slide-over panels sit last so they layer over the page.
// Geometry lives in packages/ui/app/assets/css/shell.css (.liwan-shell custom properties). Without a `sidebar` slot
// the workspace takes the whole width (data-sidebar="none").
const slots = useSlots()
defineSlots<{ sidebar?: () => unknown; topbar?: () => unknown; bottom?: () => unknown; overlay?: () => unknown; default?: () => unknown }>()
const { localeProperties } = useI18n()
const dir = computed(() => localeProperties.value.dir ?? 'ltr')
</script>

<template>
  <div data-liwan-shell class="liwan-shell" :data-direction="dir" :data-sidebar="slots.sidebar ? undefined : 'none'">
    <slot name="sidebar" />
    <div class="liwan-shell-workspace">
      <slot name="topbar" />
      <slot />
    </div>
    <slot name="bottom" />
    <slot name="overlay" />
  </div>
</template>
