<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { CrmOpportunity, CrmStage } from '@webvue/contracts'
import { formatDateTime } from '@webvue/ui/app/utils/formatDate'
import CrmCallButton from './CrmCallButton.vue'
import { isCallDue } from '@/utils/crmOpportunity'

// The pipeline as columns, one per active stage in the settings order. A record whose stage is archived or unset
// is shown in a "no stage" column so none disappears. Moving a record is done on its page, not by dragging.
const props = defineProps<{ stages: CrmStage[]; items: CrmOpportunity[]; to: (opportunity: CrmOpportunity) => RouteLocationRaw; now?: number }>()
const { t } = useI18n()
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
  <div class="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto p-(--webvue-card-pad-dense)" data-testid="crm-board">
    <section v-for="column in columns" :key="column.key" class="flex w-72 shrink-0 flex-col gap-2 rounded-card bg-elevated/40 p-2" :data-testid="`crm-board-column-${column.key}`" :aria-label="column.title">
      <header class="flex items-center justify-between gap-2 px-1 py-1">
        <h2 class="truncate text-sm font-semibold text-highlighted">{{ column.title }}</h2>
        <UBadge color="neutral" variant="subtle" class="rounded-full">{{ column.items.length }}</UBadge>
      </header>
      <p v-if="!column.items.length" class="px-1 py-3 text-sm text-muted">{{ t('crm.opportunities.board.emptyColumn') }}</p>
      <div v-for="item in column.items" :key="item.id" class="relative min-w-0">
        <NuxtLink :to="to(item)" class="block min-w-0 rounded-card bg-default p-3 pe-14 ring ring-default hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" data-testid="crm-board-card">
        <span class="block truncate font-semibold text-highlighted">{{ item.contact_name }}</span>
        <span class="mt-1 block truncate text-sm text-muted"><bdi>{{ item.phone }}</bdi></span>
        <span class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span v-if="item.user" class="truncate">{{ item.user.name }}</span>
          <UBadge v-else color="neutral" variant="subtle" class="rounded-full">{{ t('crm.opportunities.tag.pool') }}</UBadge>
          <UBadge v-if="item.needs_manager" color="warning" variant="subtle" class="rounded-full">{{ t('crm.opportunities.tag.needsManager') }}</UBadge>
          <UBadge v-else-if="isCallDue(item, clock)" color="warning" variant="subtle" class="rounded-full">{{ t('crm.opportunities.tag.due') }}</UBadge>
          <time v-else-if="item.next_call_at" :datetime="item.next_call_at">{{ formatDateTime(item.next_call_at) }}</time>
        </span>
        </NuxtLink>
        <CrmCallButton :phone="item.phone" :name="item.contact_name" class="absolute end-2 top-2" />
      </div>
    </section>
  </div>
</template>
