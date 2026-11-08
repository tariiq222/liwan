<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'

// The conversation frame: one 24px card with the conversation list on the inline-start (360px, narrowing to 260px on a tablet so the thread or info panel keeps room) and the thread
// beside it (`header`, `thread`, `composer`; `empty` when nothing is selected). An open info panel sits in a third
// 320px column from 1280px; below that it replaces the thread, which stays mounted (hidden) so its draft and
// reading offset survive. Below 768px the list, the thread and the info panel replace one another: the list shows
// until a conversation is selected. The page supplies the page header and the content of each slot.
const props = withDefaults(defineProps<{
  hasSelection: boolean
  infoOpen?: boolean
}>(), {
  infoOpen: false,
})
const { t } = useI18n()
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const canSplitInfo = useMediaQuery('(min-width: 1280px)', { ssrWidth: 1024 })
const showInfo = computed(() => props.hasSelection && props.infoOpen)
const infoInAside = computed(() => showInfo.value && canSplitInfo.value)
const showList = computed(() => isDesktop.value || !props.hasSelection)
const showThread = computed(() => (isDesktop.value || props.hasSelection) && (!showInfo.value || infoInAside.value))
const columns = computed(() => !isDesktop.value ? 'grid-cols-1' : infoInAside.value ? 'grid-cols-[360px_minmax(0,1fr)_320px]' : 'grid-cols-[clamp(260px,34vw,360px)_minmax(0,1fr)]')
</script>

<template>
  <div data-template="conversation-layout" class="grid h-[max(540px,calc(100svh-340px))] min-w-0 overflow-hidden rounded-surface border-[1.5px] border-default bg-default" :class="columns">
    <div v-if="showList" data-template="conversation-list" class="flex min-h-0 min-w-0 flex-col" :class="{ 'border-e-[1.5px] border-default': isDesktop }">
      <slot name="list" />
    </div>
    <section v-if="isDesktop || props.hasSelection" v-show="showThread" data-template="conversation-thread" class="flex min-h-0 min-w-0 flex-col">
      <template v-if="props.hasSelection">
        <div v-if="$slots.header" data-template="conversation-header" class="shrink-0">
          <slot name="header" />
        </div>
        <div data-template="conversation-messages" class="flex min-h-0 flex-1 flex-col">
          <slot name="thread" />
        </div>
        <div v-if="$slots.composer" data-template="conversation-composer" class="shrink-0">
          <slot name="composer" />
        </div>
      </template>
      <div v-else data-template="conversation-empty" class="grid flex-1 place-items-center p-6">
        <slot name="empty" />
      </div>
    </section>
    <aside v-if="showInfo" data-template="conversation-info" :aria-label="t('states.details')" class="flex min-h-0 min-w-0 flex-col overflow-y-auto bg-default" :class="{ 'border-s-[1.5px] border-default': infoInAside }">
      <slot name="info" />
    </aside>
  </div>
</template>
