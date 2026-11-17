<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import type { CrmOpportunity, CrmStage } from '@liwan/contracts'
import { avatarProps } from '@liwan/ui/app/utils/avatarTone'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import CrmCallButton from './CrmCallButton.vue'
import type { BoardMove } from '@/utils/crmBoardMove'
import { isCallDue } from '@/utils/crmOpportunity'

// The pipeline as columns, one per active stage in the settings order. A record whose stage is archived or unset
// is shown in a "no stage" column so none disappears. A card is moved by dragging it to another stage column (the same
// vue-draggable-plus mechanism as the task board; on a touch screen a short press starts the drag, so the board still
// scrolls) or with its «move» action. The board only asks: it emits `move` and the page decides (a plain stage is sent, the
// sold stage and the lost zone open a sheet). Only a card `canMove` accepts can be dragged. While an order wins the
// sale, the sold column takes no drop. With `createTo` every column ends in a dashed add tile that opens the create panel
// (the panel has no stage field yet).
const props = defineProps<{ loading?: boolean; stages: CrmStage[]; items: CrmOpportunity[]; to: (opportunity: CrmOpportunity) => RouteLocationRaw; now?: number; createTo?: RouteLocationRaw; createLabel?: string; canMove?: (opportunity: CrmOpportunity) => boolean }>()
const emit = defineEmits<{ move: [move: BoardMove] }>()
// The card: 18px, 1.5px border, a lift on hover; the call button sits in its inline-end corner, outside the link.
const CARD = 'relative overflow-hidden rounded-card border-[1.5px] border-default bg-default liwan-lift dark:shadow-(--liwan-card-highlight)'
const GROUP = 'crm-opportunities'
const { t } = useI18n()
const { me } = useMe()
const timeZone = computed(() => me.value?.tz || 'UTC')
const clock = computed(() => props.now ?? Date.now())

interface Column { key: string; title: string; stage?: CrmStage; items: CrmOpportunity[] }
const columns = computed<Column[]>(() => {
  const ordered = [...props.stages].filter(stage => stage.active).sort((a, b) => a.sequence - b.sequence || a.id - b.id)
  const known = new Set(ordered.map(stage => stage.id))
  const columnItems = ordered.map(stage => ({ key: String(stage.id), title: stage.name, stage, items: props.items.filter(item => item.stage?.id === stage.id) }))
  const orphans = props.items.filter(item => !item.stage || !known.has(item.stage.id))
  return orphans.length ? [{ key: 'none', title: t('crm.opportunities.board.noStage'), items: orphans }, ...columnItems] : columnItems
})

// The arrays the draggable columns mutate while a card is dragged; rebuilt from the records whenever they change and
// whenever a move is refused or cancelled, which is what puts the card back.
const lists = ref<Record<string, CrmOpportunity[]>>({})
const rebuild = () => { lists.value = Object.fromEntries(columns.value.map(column => [column.key, [...column.items]])) }
watch(columns, rebuild, { immediate: true })
// A revert waits for the drop's own events to finish, so it never races the list update the drag itself makes.
const revert = () => { void nextTick(rebuild) }

const dragging = ref(false)
const movable = (item: CrmOpportunity) => props.canMove?.(item) ?? false
const winByOrder = computed(() => props.items.some(item => item.win_by_order))
const soldBlocked = (column: Column) => Boolean(column.stage?.is_won) && winByOrder.value
const groupOf = (column: Column) => (column.stage && !soldBlocked(column) ? GROUP : { name: GROUP, put: false })

function onAdd(event: { data?: CrmOpportunity }, column: Column) {
  const item = event.data
  if (item && column.stage && item.stage?.id !== column.stage.id) emit('move', { item, to: column.stage, revert })
}

// The lost zone holds nothing: a card dropped on it asks for a reason, and meanwhile stays in its own column.
const lostDrop = ref<CrmOpportunity[]>([])
function onLost(event: { data?: CrmOpportunity }) {
  const item = event.data
  void nextTick(() => { lostDrop.value = [] })
  if (item) emit('move', { item, to: 'lost', revert })
  revert()
}
</script>

<template>
  <!-- While the records or stages load: columns of placeholder cards in the board's own geometry (never an empty board). -->
  <div v-if="props.loading" role="status" aria-busy="true" :aria-label="t('app.loading')" class="flex min-h-0 min-w-0 items-start gap-4 overflow-hidden pb-3" data-testid="crm-board-loading">
    <span class="sr-only">{{ t('app.loading') }}</span>
    <div v-for="column in 4" :key="column" class="flex w-[290px] shrink-0 flex-col gap-[10px]" aria-hidden="true">
      <USkeleton class="h-7 w-32" />
      <USkeleton v-for="card in 3" :key="card" class="h-[104px] rounded-card" />
    </div>
  </div>
  <template v-else>
    <div class="liwan-soft-in liwan-board-scroll flex min-h-0 min-w-0 items-start gap-4 overflow-x-auto pb-3" data-testid="crm-board">
      <section v-for="column in columns" :key="column.key" class="flex w-[290px] shrink-0 flex-col gap-[10px]" :data-testid="`crm-board-column-${column.key}`" :aria-label="column.title">
        <header class="flex items-center gap-2 px-0.5 py-1">
          <h2 class="truncate text-(length:--liwan-fs-section) font-semibold text-highlighted">{{ column.title }}</h2>
          <span class="rounded-inner bg-elevated px-2.5 text-xs/5 font-semibold text-muted tabular-nums">{{ column.items.length }}</span>
        </header>
        <p v-if="dragging && soldBlocked(column)" class="px-0.5 py-1 text-sm text-muted" data-testid="crm-board-win-hint">{{ t('crm.opportunities.board.winByOrder') }}</p>
        <p v-if="!column.items.length" class="px-0.5 py-1 text-sm text-muted">{{ t('crm.opportunities.board.emptyColumn') }}</p>
        <!-- A short press starts a drag on touch, so a swipe still scrolls the board; reordering inside a column is meaningless. -->
        <VueDraggable
          v-model="lists[column.key]!"
          class="flex min-h-16 flex-col gap-[10px]"
          :group="groupOf(column)"
          :sort="false"
          :animation="0"
          :delay="200"
          :delay-on-touch-only="true"
          chosen-class="liwan-card-chosen"
          ghost-class="liwan-card-ghost"
          filter="[data-readonly=true]"
        :prevent-on-filter="false"
          @start="dragging = true"
          @end="dragging = false"
          @add="(event: any) => onAdd(event, column)"
        >
          <div v-for="item in lists[column.key]" :key="item.id" :class="CARD" :data-readonly="!movable(item)" data-slot="crm-board-item">
            <NuxtLink :to="to(item)" :class="movable(item) ? 'pe-[104px]' : 'pe-[58px]'" class="block min-w-0 rounded-card p-[14px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary" data-testid="crm-board-card">
              <span class="block truncate text-(length:--liwan-fs-section) font-semibold text-highlighted">{{ item.contact_name }}</span>
              <span class="mt-0.5 block truncate text-end text-sm text-muted" dir="ltr"><bdi>{{ item.phone }}</bdi></span>
              <span class="mt-[10px] flex flex-wrap items-center gap-2 text-xs text-muted">
                <template v-if="item.user">
                  <UAvatar v-bind="avatarProps(item.user.name, item.user.id)" class="size-(--liwan-card-avatar) shrink-0" :ui="{ fallback: 'text-(length:--liwan-fs-avatar-initials)' }" />
                  <span class="truncate">{{ item.user.name }}</span>
                </template>
                <SharedStatusBadge v-else tone="neutral" size="sm" :label="t('crm.opportunities.tag.pool')" />
                <SharedStatusBadge v-if="item.needs_manager" tone="warning" size="sm" :label="t('crm.opportunities.tag.needsManager')" />
                <SharedStatusBadge v-else-if="isCallDue(item, clock)" tone="warning" size="sm" :label="t('crm.opportunities.tag.due')" />
                <time v-else-if="item.next_call_at" :datetime="item.next_call_at">{{ formatDateTime(item.next_call_at, timeZone) }}</time>
              </span>
            </NuxtLink>
            <div class="absolute end-[10px] top-[10px] flex gap-1.5">
            <UButton v-if="movable(item)" type="button" color="neutral" variant="soft" square icon="i-lucide-arrow-left-right" class="size-(--liwan-card-action-size) shrink-0 bg-elevated text-muted hover:text-highlighted pointer-coarse:size-11" :aria-label="t('crm.opportunities.board.moveFor', { name: item.contact_name })" :title="t('crm.opportunities.board.move')" data-testid="crm-card-move" @click.stop="emit('move', { item, to: 'pick', revert })" />
            <CrmCallButton :phone="item.phone" :name="item.contact_name" class="pointer-coarse:size-11" />
          </div>
          </div>
        </VueDraggable>
        <NuxtLink v-if="createTo" :to="createTo" class="flex h-[46px] items-center justify-center gap-1.5 rounded-control border-[1.5px] border-dashed border-default text-sm text-muted transition-colors hover:border-(--primary-solid) hover:bg-[color-mix(in_srgb,var(--primary-solid)_5%,transparent)] hover:text-highlighted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none" data-testid="crm-board-add">
          <UIcon name="i-lucide-plus" class="size-4" aria-hidden="true" />
          <span>{{ createLabel }}</span>
        </NuxtLink>
      </section>
    </div>
    <!-- Only while a card is dragged: the one place a card can be dropped to close it as lost. The keyboard path is «move». -->
    <div class="fixed inset-x-4 bottom-[calc(var(--shell-tabbar-height)+env(safe-area-inset-bottom)+1rem)] z-20 md:bottom-4 mx-auto h-14 max-w-md rounded-card border-[1.5px] border-dashed border-error bg-default text-error transition-opacity motion-reduce:transition-none" :class="dragging ? 'opacity-100' : 'invisible opacity-0'" aria-hidden="true" data-testid="crm-board-lost-zone">
      <span class="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm font-semibold"><UIcon name="i-lucide-circle-x" class="size-4" />{{ t('crm.opportunities.lost.action') }}</span>
      <VueDraggable v-model="lostDrop" class="absolute inset-0" :group="{ name: GROUP, pull: false, put: true }" :sort="false" :animation="0" @add="(event: any) => onLost(event)" />
    </div>
  </template>
</template>
