<script setup lang="ts">
import type { CrmDashboardSourceSchema } from '@webvue/contracts'
import type { z } from 'zod'
import { conversionPercent } from '@/utils/crmDashboard'

// Conversion by source over the records created this month: for each source how many of them were won, as a bar and "won of total". A record
// without a source is its own row.
defineProps<{ sources: z.infer<typeof CrmDashboardSourceSchema>[] }>()
const { t } = useI18n()
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('crm.dashboard.manager.conversionTitle')" :description="t('crm.dashboard.manager.conversionHint')" data-testid="crm-conversion">
    <SharedEmptyState v-if="!sources.length" :title="t('crm.dashboard.manager.conversionEmpty')" />
    <ul v-else class="grid gap-4">
      <li v-for="source in sources" :key="source.source_id ?? 'none'" class="grid gap-1.5">
        <div class="flex min-w-0 items-baseline justify-between gap-3 text-sm">
          <span class="min-w-0 truncate font-semibold text-highlighted">{{ source.name || t('crm.dashboard.manager.noSource') }}</span>
          <span class="shrink-0 text-muted tabular-nums">{{ t('crm.dashboard.manager.conversionRow', { won: source.won, total: source.total }) }} · {{ conversionPercent(source.won, source.total) }}%</span>
        </div>
        <SharedProgress :value="conversionPercent(source.won, source.total)" tone="success" :label="source.name || t('crm.dashboard.manager.noSource')" />
      </li>
    </ul>
  </SharedRecordSection>
</template>
