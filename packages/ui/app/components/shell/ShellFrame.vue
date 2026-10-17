<script setup lang="ts">
// The floating application frame: header, module rail and context sidebar are
// cards floating on the canvas around the scrolling workspace. Geometry lives in
// packages/ui/app/assets/css/shell.css (.webvue-shell custom properties).
const props = defineProps<{ noSidebar?: boolean }>()
defineSlots<{ header?: () => unknown; sidebar?: () => unknown; default?: () => unknown }>()
const { localeProperties } = useI18n()
const dir = computed(() => localeProperties.value.dir ?? 'ltr')
</script>

<template>
  <div data-webvue-shell class="webvue-shell" :data-direction="dir" :data-sidebar="props.noSidebar ? 'none' : undefined">
    <slot name="header" />
    <slot name="sidebar" />
    <div class="webvue-shell-workspace">
      <slot />
    </div>
  </div>
</template>
