<script setup lang="ts">
// The conversation frame: one 24px card with the conversation list on the inline-start (360px, narrowing to 260px on a
// tablet so the thread or info panel keeps room) and the thread beside it (`header`, `thread`, `composer`; `empty` when
// nothing is selected). An open info panel sits in a third 320px column from 1280px; below that it replaces the thread,
// which stays mounted (hidden) so its draft and reading offset survive. Below 768px the list, the thread and the info
// panel replace one another: the list shows until a conversation is selected.
//
// The width decisions are CSS classes, never a JavaScript media query: the server renders the same markup the client
// keeps, so a phone cannot receive (or flash) the desktop two-column frame and no hydration step has to correct it. The
// selection is in the URL, so `hasSelection` already tells the server which pane to show.
const props = withDefaults(defineProps<{
  hasSelection: boolean
  infoOpen?: boolean
}>(), {
  infoOpen: false,
})
const { t } = useI18n()
const showInfo = computed(() => props.hasSelection && props.infoOpen)
// No selection: the list alone on a phone, the list beside the empty thread from 768px.
// A selection: the thread alone on a phone; the list and the thread from 768px.
// A selection with the info panel: the panel alone on a phone, the list and the panel from 768px, and the list, the
// thread and the panel from 1280px.
const columns = computed(() => {
  if (!props.hasSelection) return 'grid-cols-1 md:grid-cols-[clamp(260px,34vw,360px)_minmax(0,1fr)]'
  if (!showInfo.value) return 'grid-cols-1 md:grid-cols-[clamp(260px,34vw,360px)_minmax(0,1fr)]'
  return 'grid-cols-1 md:grid-cols-[clamp(260px,34vw,360px)_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)_320px]'
})
const listClass = computed(() => (props.hasSelection ? 'hidden md:flex' : 'flex'))
const threadClass = computed(() => {
  if (!props.hasSelection) return 'hidden md:flex'
  return showInfo.value ? 'hidden xl:flex' : 'flex'
})
</script>

<template>
  <div data-template="conversation-layout" class="grid h-[max(540px,calc(100svh-340px))] min-w-0 overflow-hidden rounded-surface border-[1.5px] border-default bg-default" :class="columns">
    <div data-template="conversation-list" class="min-h-0 min-w-0 flex-col md:border-e-[1.5px] md:border-default" :class="listClass">
      <slot name="list" />
    </div>
    <section data-template="conversation-thread" class="min-h-0 min-w-0 flex-col" :class="threadClass">
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
    <aside v-if="showInfo" data-template="conversation-info" :aria-label="t('states.details')" class="flex min-h-0 min-w-0 flex-col overflow-y-auto bg-default xl:border-s-[1.5px] xl:border-default">
      <slot name="info" />
    </aside>
  </div>
</template>
