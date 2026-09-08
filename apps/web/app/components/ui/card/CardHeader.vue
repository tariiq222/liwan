<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="card-header"
    :class="cn('@container/card-header grid min-w-0 min-h-[54px] auto-rows-min items-center gap-1.5 rounded-t-[inherit] border-b bg-muted/70 px-5 py-3.5 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]', props.class)"
  >
    <slot />
  </div>
</template>
