<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { CrmOpportunity, CrmStage } from '@liwan/contracts'
import { avatarProps } from '@liwan/ui/app/utils/avatarTone'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import CrmCallButton from './CrmCallButton.vue'
import { isCallDue } from '@/utils/crmOpportunity'

// The pipeline as columns, one per active stage in the settings order. A record whose stage is archived or unset
// is shown in a "no stage" column so none disappears. Moving a record is done on its page, not by dragging. With
// `createTo` every column ends in a dashed add tile that opens the create panel (the panel has no stage field yet).
const props = defineProps<{ loading?: boolean; stages: CrmStage[]; items: CrmOpportunity[]; to: (opportunity: CrmOpportunity) => RouteLocationRaw; now?: number; createTo?: RouteLocationRaw; createLabel?: string }>()
// The card: 18px, 1.5px border, a lift on hover; the call button sits in its inline-end corner, outside the link.
const CARD = 'relative overflow-hidden rounded-card border-[1.5px] border-default bg-default liwan-lift dark:shadow-(--liwan-card-highlight)'
const { t } = useI18n()
const { me } = useMe()
const timeZone = computed(() => me.value?.tz || 'UTC')
const clock = computed(() => props.now ?? Date.now())

interface Column { key: string; title: string; items: CrmOpportunity[] }
const columns = computed<Column[]>(() => {
  const ordered = [...props.stages].filter(stage => stage.active).sort((a, b) => a.sequence - b.sequence || a.id - b.id)
  const known = new Set(ordered.map(stage => stage.id))
  const columnItems = ordered.map(stage => ({ key: String(stage.id), title: stage.name, items: props.items.filter(item => item.stage?.id === stage.id) }))
  const orphans = props.items.filter(item => !item.stage || !known.has(item.stage.id))
  return orphans.length ? [{ key: 'none', title: t('crm.opportunities.board.noStage'), items: orphans }, ...columnItems] : columnItems
})
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
  <div v-else class="liwan-soft-in flex min-h-0 min-w-0 items-start gap-4 overflow-x-auto pb-3" data-testid="crm-board">
    <section v-for="column in columns" :key="column.key" class="flex w-[290px] shrink-0 flex-col gap-[10px]" :data-testid="`crm-board-column-${column.key}`" :aria-label="column.title">
      <header class="flex items-center gap-2 px-0.5 py-1">
        <h2 class="truncate text-(length:--liwan-fs-section) font-semibold text-highlighted">{{ column.title }}</h2>
        <span class="rounded-inner bg-elevated px-2.5 text-xs/5 font-semibold text-muted tabular-nums">{{ column.items.length }}</span>
      </header>
      <p v-if="!column.items.length" class="px-0.5 py-1 text-sm text-muted">{{ t('crm.opportunities.board.emptyColumn') }}</p>
      <div v-for="item in column.items" :key="item.id" :class="CARD" data-slot="crm-board-item">
        <NuxtLink :to="to(item)" class="block min-w-0 rounded-card p-[14px] pe-[58px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary" data-testid="crm-board-card">
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
        <CrmCallButton :phone="item.phone" :name="item.contact_name" class="absolute end-[10px] top-[10px]" />
      </div>
      <NuxtLink v-if="createTo" :to="createTo" class="flex h-[46px] items-center justify-center gap-1.5 rounded-control border-[1.5px] border-dashed border-default text-sm text-muted transition-colors hover:border-(--primary-solid) hover:bg-[color-mix(in_srgb,var(--primary-solid)_5%,transparent)] hover:text-highlighted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none" data-testid="crm-board-add">
        <UIcon name="i-lucide-plus" class="size-4" aria-hidden="true" />
        <span>{{ createLabel }}</span>
      </NuxtLink>
    </section>
  </div>
</template>
