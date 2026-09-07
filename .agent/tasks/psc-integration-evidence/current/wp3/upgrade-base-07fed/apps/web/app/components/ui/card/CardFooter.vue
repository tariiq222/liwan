<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="card-footer"
    :class="cn('flex flex-wrap items-center gap-2 border-t p-[18px]', props.class)"
  >
    <slot />
  </div>
</template>
