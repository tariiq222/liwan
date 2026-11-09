<script setup lang="ts">
import type { ShellTabItem } from '../../types/shell'

// The phone's bottom navigation: link tabs, and a button tab (no `to`) that opens the drawer. Hidden from 768px up.
const props = defineProps<{ items: ShellTabItem[]; label: string; disabled?: boolean }>()
const emit = defineEmits<{ press: [item: ShellTabItem, event: MouseEvent] }>()
</script>

<template>
  <nav class="liwan-tabbar liwan-print-hide" data-testid="shell-tabbar" data-fresh-navigation :aria-label="props.label">
    <template v-for="item in props.items" :key="item.id">
      <NuxtLink v-if="item.to" :to="item.to" class="liwan-tabbar-item" :data-active="item.active ? 'true' : undefined" :aria-current="item.active ? 'page' : undefined" :data-testid="item.testId ?? `tab-${item.id}`">
        <UIcon :name="item.icon" aria-hidden="true" />
        <span data-slot="label">{{ item.label }}</span>
      </NuxtLink>
      <button v-else type="button" class="liwan-tabbar-item" :data-active="item.active ? 'true' : undefined" :disabled="props.disabled" :data-testid="item.testId ?? `tab-${item.id}`" aria-haspopup="dialog" @click="emit('press', item, $event)">
        <UIcon :name="item.icon" aria-hidden="true" />
        <span data-slot="label">{{ item.label }}</span>
      </button>
    </template>
  </nav>
</template>
