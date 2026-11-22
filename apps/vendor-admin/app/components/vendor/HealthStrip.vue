<script setup lang="ts">
import type { ServiceHealthItem } from '@liwan/commercial-contracts'
import { healthChips, type HealthChip } from '@/utils/vendorHealth'
import { formatBusinessDateTime } from '@/utils/vendorTime'
const props = defineProps<{ items: readonly ServiceHealthItem[] | null, now: Date, lastCheckAt: string | null }>()
const { t } = useI18n()
const chips = computed(() => props.items ? healthChips(props.items, props.now) : [])
const TONE_CLASS: Record<HealthChip['tone'], string> = { success: 'text-success', destructive: 'text-error', neutral: 'text-muted' }
</script>
<template>
  <div class="space-y-2" data-slot="health-strip">
    <p v-if="!items" class="text-sm text-warning" data-testid="today-health-unreadable">{{ t('vendor.today.health.unreadable') }}</p>
    <ul v-else class="flex flex-wrap gap-2">
      <li v-for="chip in chips" :key="chip.component" class="flex items-center gap-2 rounded-control px-3 py-2 ring ring-default" :data-testid="`health-${chip.component}`" :data-state="chip.state">
        <UIcon :name="chip.icon" class="size-5 shrink-0" :class="TONE_CLASS[chip.tone]" aria-hidden="true" />
        <span class="min-w-0">
          <span class="block text-sm font-medium text-highlighted">{{ t(`vendor.today.health.components.${chip.component}`) }}</span>
          <span class="block text-sm" :class="TONE_CLASS[chip.tone]">{{ t(`vendor.today.health.states.${chip.state}`) }}<template v-if="chip.lastBeat"> · {{ t(`vendor.today.health.ago${chip.lastBeat.unit === 'minutes' ? 'Minutes' : chip.lastBeat.unit === 'hours' ? 'Hours' : 'Days'}`, { count: chip.lastBeat.count }, chip.lastBeat.count) }}</template></span>
          <span v-if="chip.code" class="block text-xs text-muted"><bdi>{{ chip.code }}</bdi></span>
          <span v-if="chip.failedJobs.length" class="block text-xs text-muted">{{ t('vendor.today.health.failedJobs', { jobs: chip.failedJobs.join(', ') }) }}</span>
        </span>
      </li>
    </ul>
    <p v-if="lastCheckAt" class="text-sm text-muted">{{ t('vendor.today.health.lastWorkspaceCheck') }}: <time :datetime="lastCheckAt">{{ formatBusinessDateTime(lastCheckAt) }}</time></p>
  </div>
</template>
