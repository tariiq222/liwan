<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <th
    data-slot="table-head"
    :class="cn('bg-transparent px-4 py-3 text-start text-[0.786rem] text-muted-foreground align-middle font-normal whitespace-nowrap [&:has([role=checkbox])]:pe-0 *:[[role=checkbox]]:translate-y-0.5', props.class)"
  >
    <slot />
  </th>
</template>
