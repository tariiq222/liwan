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
    class="nasq-context-link nasq-context-create"
    :data-active="active"
    :active="active"
    :aria-current="active ? 'page' : undefined"
    :data-testid="testId"
    :aria-label="label"
    :title="label"
    :label="label"
  >
    <template #leading>
      <UIcon name="i-lucide-plus" class="nasq-shell-icon size-[18px] shrink-0" aria-hidden="true" />
    </template>
  </UButton>
</template>
