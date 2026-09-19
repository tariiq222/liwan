<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import type { ChartConfig } from "."
import { computed, onMounted, ref } from "vue"

const props = withDefaults(defineProps<{
  config: ChartConfig
  nameKey?: string
  verticalAlign?: "bottom" | "top"
  class?: HTMLAttributes["class"]
}>(), {
  verticalAlign: "bottom",
})

const payload = computed(() => Object.entries(props.config).map(([key, value]) => {
  return {
    key: props.nameKey || key,
    itemConfig: value,
  }
}))

// The legend enumerates chart config synchronously, but waits for mount so it
// never renders ahead of the chart it labels during SSR.
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
</script>

<template>
  <div
    v-if="mounted"
    :class="[
      'flex items-center justify-center gap-4',
      verticalAlign === 'top' ? 'pb-3' : 'pt-3',
      props.class,
    ]"
  >
    <div
      v-for="{ key, itemConfig } in payload"
      :key="key"
      class="[&>svg]:text-muted flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3"
    >
      <div
        class="h-2 w-2 shrink-0 rounded-xs"
        :style="{
          backgroundColor: itemConfig?.color,
        }"
      />

      {{ itemConfig.label }}
    </div>
  </div>
</template>
