<script setup lang="ts">
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
  <UButton
    :to="to"
    color="primary"
    variant="solid"
    class="webvue-context-link webvue-context-create"
    :data-active="active"
    :active="active"
    :aria-current="active ? 'page' : undefined"
    :data-testid="testId"
    :aria-label="label"
    :title="label"
    :label="label"
  >
    <template #leading>
      <UIcon name="i-lucide-plus" class="webvue-shell-icon size-4.5 shrink-0" aria-hidden="true" />
    </template>
  </UButton>
</template>
