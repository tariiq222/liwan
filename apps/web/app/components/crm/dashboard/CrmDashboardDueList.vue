<script setup lang="ts">
import type { CrmOpportunity } from '@liwan/contracts'
import { relativeTime } from '@/utils/crmOpportunity'

// The agent's calls that are due now, oldest first as the server sends them: the name opens the record, the phone is a tel: link.
// `total` is how many are due, so the list can say it shows only the first few.
const props = defineProps<{ items: CrmOpportunity[]; total: number; viewAllTo: string; now?: number }>()
const { t, locale } = useI18n()
const clock = computed(() => props.now ?? Date.now())
</script>

<template>
  <SharedRecordSection variant="list" :title="t('crm.dashboard.agent.dueTitle')" data-testid="crm-due-list">
    <SharedEmptyState v-if="!items.length" class="m-(--liwan-card-pad-dense)" :title="t('crm.dashboard.agent.dueEmpty')" />
    <ul v-else class="divide-y divide-default">
      <li v-for="item in items" :key="item.id" class="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-(--liwan-card-pad) py-3">
        <div class="min-w-0">
          <NuxtLink :to="`/crm/opportunities/${item.id}`" class="block truncate font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ item.contact_name }}</NuxtLink>
          <time v-if="item.next_call_at" class="text-xs text-warning" :datetime="item.next_call_at">{{ relativeTime(item.next_call_at, clock, locale) }}</time>
        </div>
        <UButton :href="`tel:${item.phone}`" color="neutral" variant="outline" size="sm" icon="i-lucide-phone" :aria-label="t('crm.dashboard.agent.call', { name: item.contact_name })" data-testid="crm-due-phone"><bdi>{{ item.phone }}</bdi></UButton>
      </li>
    </ul>
    <template v-if="total > items.length" #actions>
      <NuxtLink :to="viewAllTo" class="text-sm font-semibold text-primary hover:underline">{{ t('crm.dashboard.agent.dueAll') }}</NuxtLink>
    </template>
  </SharedRecordSection>
</template>
