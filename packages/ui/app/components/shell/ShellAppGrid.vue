<script setup lang="ts">
// The content of the app switcher popover: a grid of coloured tiles with the application names. Labels arrive
// translated, so the grid stays presentational.
const props = defineProps<{ apps: { id: string; label: string; icon: string; to: string }[]; label: string }>()
const emit = defineEmits<{ navigate: [id: string] }>()
</script>

<template>
  <nav class="liwan-app-grid" data-testid="app-switcher-grid" data-fresh-navigation :aria-label="props.label">
    <NuxtLink v-for="entry in props.apps" :key="entry.id" :to="entry.to" class="liwan-app-grid-item" :data-testid="`app-switcher-${entry.id}`" @click="emit('navigate', entry.id)">
      <ShellAppTile :icon="entry.icon" :app="entry.id" size="lg" />
      <span data-slot="label">{{ entry.label }}</span>
    </NuxtLink>
  </nav>
</template>
