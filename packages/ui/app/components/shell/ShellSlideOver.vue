<script setup lang="ts">
import { onClickOutside, useEventListener } from '@vueuse/core'
import type { RouteLocationRaw } from 'vue-router'
import { overlayOwnsEscape } from '../../composables/useEscapeBack'

// A panel that opens under the top bar on the inline-end side (380px): title, an "open all" link, close, and the
// body. It is not a modal: the page behind stays usable, and the panel closes on Escape, on a click outside it, on
// a second click of its trigger and, in the app, on a route change. The trigger is marked `data-slide-over-trigger`
// and is ignored by the outside click, as are menus and popovers opened from inside the panel. Focus returns to the
// trigger through the host's `close`. Closed, the panel is only hidden, so a host that keeps it mounted (the
// assistant's half-typed message) keeps its content.
const props = defineProps<{
  open: boolean
  id: string
  title: string
  closeLabel: string
  allTo?: RouteLocationRaw
  allLabel?: string
  /** The body fills the panel edge to edge (a hosted component with its own padding). */
  flush?: boolean
}>()
const emit = defineEmits<{ close: [] }>()
defineSlots<{ lead?: () => unknown; default?: () => unknown }>()
const panel = ref<HTMLElement | null>(null)
onClickOutside(panel, () => { if (props.open) emit('close') }, { ignore: ['[data-slide-over-trigger]', '[data-dismissable-layer]', '[data-reka-popper-content-wrapper]'] })
useEventListener(() => (typeof document === 'undefined' ? undefined : document), 'keydown', (event: KeyboardEvent) => {
  // A menu or dialog that owns the key (reka-ui layers) closes first; an IME composition keeps it too.
  if (!props.open || event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229 || overlayOwnsEscape(document)) return
  event.stopPropagation()
  emit('close')
}, { capture: true })
</script>

<template>
  <Transition name="liwan-slideover">
    <aside v-show="props.open" :id="props.id" ref="panel" class="liwan-slideover liwan-print-hide" tabindex="-1" role="dialog" aria-modal="false" :aria-label="props.title" :data-testid="props.id">
      <div class="liwan-slideover-head">
        <slot name="lead" />
        <h2 class="liwan-slideover-title">{{ props.title }}</h2>
        <NuxtLink v-if="props.allTo" :to="props.allTo" class="liwan-slideover-all" :data-testid="`${props.id}-all`">{{ props.allLabel }}</NuxtLink>
        <button type="button" class="liwan-slideover-close" :style="props.allTo ? undefined : 'margin-inline-start:auto'" :aria-label="props.closeLabel" :data-testid="`${props.id}-close`" @click="emit('close')">
          <UIcon name="i-lucide-x" class="size-4" aria-hidden="true" />
        </button>
      </div>
      <div class="liwan-slideover-body" :data-flush="props.flush ? 'true' : undefined"><slot /></div>
    </aside>
  </Transition>
</template>
