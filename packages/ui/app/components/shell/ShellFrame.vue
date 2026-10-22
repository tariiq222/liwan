<script setup lang="ts">
// The floating application frame: header, module rail and context sidebar are
// cards floating on the canvas around the scrolling workspace. Geometry lives in
// packages/ui/app/assets/css/shell.css (.webvue-shell custom properties). The optional `sheet` slot hosts a docked side
// sheet; `sheetOpen` sets data-sheet="open", which assistant-sheet.css reads to make room for it.
const props = defineProps<{ noSidebar?: boolean; sheetOpen?: boolean }>()
defineSlots<{ header?: () => unknown; sidebar?: () => unknown; sheet?: () => unknown; default?: () => unknown }>()
const { localeProperties } = useI18n()
const dir = computed(() => localeProperties.value.dir ?? 'ltr')
</script>

<template>
  <div data-webvue-shell class="webvue-shell" :data-direction="dir" :data-sidebar="props.noSidebar ? 'none' : undefined" :data-sheet="props.sheetOpen ? 'open' : undefined">
    <slot name="header" />
    <slot name="sidebar" />
    <div class="webvue-shell-workspace">
      <slot />
    </div>
    <slot name="sheet" />
  </div>
</template>
