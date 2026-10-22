<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { LauncherEntry } from '@/composables/nav/launcherModel'

// One application on the launcher: its icon, name and one-line description, the link that opens it, a link to its start
// page, and the pin toggle. A pinned application also gets the two order buttons. Several actions, so the card itself
// is not a link (SharedLinkCard is a single link). The pin toggle keeps one name and says its state with `aria-pressed`.
// An order button at its end stays focusable (`aria-disabled`), and after a move the focus stays on the button that was
// used, because moving the card in the list can drop it.
const props = defineProps<{
  entry: LauncherEntry
  description?: string
  /** Number of pinned applications on show, to know whether this one can move later. */
  pinnedCount: number
  /** The pin controls wait for hydration: the stored choice is read in the browser. */
  disabled?: boolean
}>()
const emit = defineEmits<{ toggle: []; move: [delta: -1 | 1] }>()
const { t } = useI18n()
const id = useId()
const earlier = ref<{ $el: HTMLElement } | null>(null)
const later = ref<{ $el: HTMLElement } | null>(null)
const atStart = computed(() => props.entry.pinIndex === 0)
const atEnd = computed(() => props.entry.pinIndex === props.pinnedCount - 1)
async function move(delta: -1 | 1) {
  if (props.disabled || (delta < 0 ? atStart.value : atEnd.value)) return
  emit('move', delta)
  await nextTick()
  ;(delta < 0 ? earlier : later).value?.$el.focus()
}
</script>

<template>
  <article
    data-testid="launcher-card"
    :data-app="props.entry.id"
    :data-pinned="props.entry.pinned || undefined"
    :aria-labelledby="`${id}-title`"
    class="flex min-w-0 flex-col gap-3 rounded-card bg-default p-4 ring ring-default"
  >
    <div class="flex min-w-0 items-start gap-3">
      <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
        <UIcon :name="props.entry.icon" class="size-5" />
      </span>
      <div class="grid min-w-0 flex-1 gap-0.5">
        <h2 :id="`${id}-title`" class="truncate text-sm font-semibold text-highlighted">{{ t(props.entry.labelKey) }}</h2>
        <p v-if="props.description" class="line-clamp-2 text-xs text-muted">{{ props.description }}</p>
      </div>
      <span v-if="props.entry.pinned" class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary" data-testid="launcher-pinned-pill">{{ t('launcher.pinned') }}</span>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <UButton :to="props.entry.to" size="sm" class="rounded-full" data-testid="launcher-open" :label="t('launcher.open')" :aria-describedby="`${id}-title`" />
      <UButton :to="props.entry.overviewTo" size="sm" color="neutral" variant="outline" class="rounded-full" data-testid="launcher-overview" :label="t('launcher.overview')" :aria-describedby="`${id}-title`" />
      <UButton
        v-if="props.entry.pinnable"
        type="button"
        size="sm"
        color="neutral"
        variant="ghost"
        class="rounded-full"
        data-testid="launcher-pin"
        :icon="props.entry.pinned ? 'i-lucide-pin-off' : 'i-lucide-pin'"
        :label="t('launcher.pin')"
        :aria-pressed="props.entry.pinned"
        :aria-describedby="`${id}-title`"
        :disabled="props.disabled"
        @click="emit('toggle')"
      />
      <div v-if="props.entry.pinned" role="group" :aria-label="t('launcher.order')" class="ms-auto flex items-center gap-1">
        <UButton ref="earlier" type="button" size="sm" color="neutral" variant="ghost" square icon="i-lucide-chevron-up" class="aria-disabled:opacity-50" data-testid="launcher-move-earlier" :aria-label="t('launcher.moveEarlier', { name: t(props.entry.labelKey) })" :title="t('launcher.moveEarlier', { name: t(props.entry.labelKey) })" :disabled="props.disabled" :aria-disabled="atStart || undefined" @click="move(-1)" />
        <UButton ref="later" type="button" size="sm" color="neutral" variant="ghost" square icon="i-lucide-chevron-down" class="aria-disabled:opacity-50" data-testid="launcher-move-later" :aria-label="t('launcher.moveLater', { name: t(props.entry.labelKey) })" :title="t('launcher.moveLater', { name: t(props.entry.labelKey) })" :disabled="props.disabled" :aria-disabled="atEnd || undefined" @click="move(1)" />
      </div>
    </div>
  </article>
</template>
