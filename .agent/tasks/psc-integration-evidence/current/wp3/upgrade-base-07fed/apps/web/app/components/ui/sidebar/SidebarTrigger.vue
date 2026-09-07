<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { PanelLeft } from "@lucide/vue"
import { cn } from "@/lib/utils"
import { Button } from '@/components/ui/button'
import { useSidebar } from "./utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()

const { toggleSidebar, openMobile, isMobile } = useSidebar()
const hydrated = useHydrated()
</script>

<template>
  <Button
    data-sidebar="trigger"
    data-slot="sidebar-trigger"
    variant="ghost"
    size="icon"
    :class="cn('size-[32px] rounded-lg', props.class)"
    :disabled="!hydrated" :aria-expanded="isMobile ? openMobile : undefined" :aria-controls="isMobile ? 'mobile-navigation' : undefined" @click="toggleSidebar"
  >
    <PanelLeft />
    <span class="sr-only">{{ $t('nav.toggleSidebar') }}</span>
  </Button>
</template>
