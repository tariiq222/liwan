<script setup lang="ts">
// An application's icon tile: a solid rounded square in the application's colour (ink for a free application),
// through `data-app` (app-identity.css). Sizes: sm 26px (sidebar rows), md 32px (panel headers), lg 44px (switcher).
const props = withDefaults(defineProps<{ icon: string; app?: string; size?: 'sm' | 'md' | 'lg' }>(), { size: 'sm' })
</script>

<template>
  <span class="liwan-app-tile liwan-side-tile" :data-app="props.app" :data-size="props.size" aria-hidden="true">
    <UIcon :name="props.icon" />
  </span>
</template>
