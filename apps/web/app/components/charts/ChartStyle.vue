<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import type { ChartConfig } from "."
import { Primitive } from "reka-ui"
import { computed } from "vue"

const props = defineProps<{
  id?: HTMLAttributes["id"]
  config: ChartConfig
}>()

const colorConfig = computed(() => {
  return Object.entries(props.config).filter(([, itemConfig]) => itemConfig.color)
})
</script>

<template>
  <Primitive
    v-if="colorConfig.length"
    as="style"
  >
    {{ `[data-chart=${id}] {
${colorConfig.map(([key, itemConfig]) => `  --color-${key}: ${itemConfig.color};`).join("\n")}
}` }}
  </Primitive>
</template>
