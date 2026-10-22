<script setup lang="ts">
import type { AppCommand, AppPersonalEntry, AppPersonalSummary } from '@/modules/types'
defineProps<{ entry: AppPersonalEntry; data?: AppPersonalSummary; pending?: boolean; error?: unknown; action?: AppCommand | null; customize?: boolean; first?: boolean; last?: boolean }>()
defineEmits<{ retry: []; move: [direction: -1 | 1] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <SharedRecordSection variant="panel" :data-testid="`personal-card-${entry.section}`">
    <div class="flex h-full flex-col gap-4">
      <div class="flex items-center gap-3">
        <span class="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden="true"><UIcon :name="entry.icon" class="size-5" /></span>
        <h2 class="min-w-0 flex-1 font-semibold text-highlighted"><NuxtLink :to="entry.to" class="rounded hover:underline focus-visible:ring-2 focus-visible:ring-primary">{{ t(entry.labelKey) }}</NuxtLink></h2>
        <div v-if="customize" class="flex gap-1">
          <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :disabled="!hydrated || first" :aria-label="t('account.moveUp', { name: t(entry.labelKey) })" @click="$emit('move', -1)" />
          <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :disabled="!hydrated || last" :aria-label="t('account.moveDown', { name: t(entry.labelKey) })" @click="$emit('move', 1)" />
        </div>
      </div>
      <div class="flex-1">
        <SharedPageState :loading="pending" :error="error" @retry="$emit('retry')">
          <p v-if="data?.value" class="text-xl font-semibold text-highlighted">{{ data.value }}</p>
          <p class="mt-1 text-sm leading-6 text-muted">{{ data?.caption ?? t(entry.descriptionKey) }}</p>
          <ul v-if="data?.rows?.length" class="mt-3 divide-y divide-default">
            <li v-for="row in data.rows" :key="row.id" class="py-2">
              <NuxtLink :to="row.to" class="block rounded focus-visible:ring-2 focus-visible:ring-primary">
                <span class="text-sm font-medium text-highlighted">{{ row.label }}</span>
                <span v-if="row.caption" class="mt-0.5 block text-xs text-muted">{{ row.caption }}</span>
              </NuxtLink>
            </li>
          </ul>
        </SharedPageState>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UButton v-if="action" :to="{ path: action.to, query: { returnTo: '/account' } }" :label="t(action.labelKey)" :icon="action.icon" :disabled="!hydrated" />
        <UButton :to="entry.to" color="neutral" variant="outline" :label="t('account.openSection', { name: t(entry.labelKey) })" :disabled="!hydrated" />
      </div>
    </div>
  </SharedRecordSection>
</template>
