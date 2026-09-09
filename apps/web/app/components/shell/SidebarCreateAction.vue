<script setup lang="ts">
import { Plus } from '@lucide/vue'
import type { RouteLocationRaw } from 'vue-router'

withDefaults(defineProps<{
  to: RouteLocationRaw
  label: string
  active?: boolean
  testId?: string
}>(), {
  active: false,
})
</script>

<template>
  <NuxtLink
    :to="to"
    class="nasq-context-link nasq-context-create"
    :data-active="active"
    :aria-current="active ? 'page' : undefined"
    :data-testid="testId"
    :aria-label="label"
    :title="label"
  >
    <Plus aria-hidden="true" />
    <span>{{ label }}</span>
  </NuxtLink>
</template>
