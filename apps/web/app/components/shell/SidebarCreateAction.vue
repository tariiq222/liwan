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
  <UButton
    :to="to"
    color="secondary"
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
      <Plus aria-hidden="true" />
    </template>
  </UButton>
</template>
