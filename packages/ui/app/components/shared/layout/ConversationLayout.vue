<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'

// The conversation template (Tasmim Plan 4), taken from chat/ChatWorkspace.vue.
// From 768px the conversation list is the application's context-sidebar panel
// (AppManifest.sidebarPanel), so this renders only the thread column (`header`,
// `thread`, `composer`). An open info panel sits beside it from 1280px; below that it
// uses the available region so the context sidebar cannot squeeze the composer.
// Hide the selected thread while info takes that region; retain its history and reading offset.
// With nothing selected it shows `empty`. Below 768px the `list` fills the page until
// a conversation is selected; the thread then replaces it (its header carries the back
// link to the list), and an open info panel replaces the thread.
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
const showList = computed(() => !isDesktop.value && !props.hasSelection)
const showThread = computed(() => (isDesktop.value || props.hasSelection) && (!showInfo.value || infoInAside.value))
</script>

<template>
  <SharedPageContainer width="list" data-template="conversation-layout" class="h-[calc(100svh_-_var(--shell-top,0px))] min-h-0 grid-rows-[minmax(0,1fr)]">
    <div class="flex min-h-0 overflow-hidden bg-default">
      <div v-if="showList" data-template="conversation-list" class="flex min-h-0 min-w-0 flex-1 flex-col">
        <slot name="list" />
      </div>
      <section v-if="isDesktop || props.hasSelection" v-show="showThread" data-template="conversation-thread" class="flex min-h-0 min-w-0 flex-1 flex-col">
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
      <aside v-if="showInfo" data-template="conversation-info" :aria-label="t('states.details')" class="flex min-h-0 flex-col overflow-y-auto bg-default" :class="infoInAside ? 'w-80 shrink-0 md:border-s md:border-default' : 'min-w-0 flex-1'">
        <slot name="info" :headingLevel="infoInAside ? 'h2' : 'h1'" />
      </aside>
    </div>
  </SharedPageContainer>
</template>
