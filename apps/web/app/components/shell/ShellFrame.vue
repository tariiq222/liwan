<script setup lang="ts">
// The Tasmim application frame (spec 2026-10-11 §5): fixed header, fixed
// midnight module rail, context sidebar and the scrolling workspace. Geometry
// lives in assets/css/shell.css (.nasq-shell custom properties).
const props = defineProps<{ noSidebar?: boolean }>()
defineSlots<{ header?: () => unknown; sidebar?: () => unknown; default?: () => unknown }>()
const { localeProperties } = useI18n()
const dir = computed(() => localeProperties.value.dir ?? 'ltr')
</script>

<template>
  <div data-nasq-shell class="nasq-shell" :data-direction="dir" :data-sidebar="props.noSidebar ? 'none' : undefined" :style="props.noSidebar ? { '--context-sidebar-width': '0px' } : undefined">
    <slot name="header" />
    <slot name="sidebar" />
    <div class="nasq-shell-workspace">
      <slot />
    </div>
  </div>
</template>
