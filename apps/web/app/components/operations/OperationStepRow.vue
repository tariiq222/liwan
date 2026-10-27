<script setup lang="ts">
import { joinList } from '@/utils/listFormat'
import type { PersonRef } from '@webvue/contracts'
import { operationsStateTone } from '@/composables/operations/state'

// One approval stage as a read-only row: its number and name, who reviews it and, on a request, where it stands.
// The stage editor of ProcessForm is a different surface (inputs) and builds on SharedSubCard directly.
defineProps<{ number: number; name: string; reviewers: PersonRef[]; status?: string }>()
const { t } = useI18n()
</script>

<template>
  <SharedSubCard as="li" class="flex flex-wrap items-center justify-between gap-3">
    <div class="min-w-0 flex-1">
      <h3 class="text-sm font-semibold text-highlighted">{{ number }}. {{ name }}</h3>
      <p class="mt-1 flex min-w-0 items-center gap-2 text-sm text-muted"><SharedPersonAvatar :people="reviewers" /><span class="min-w-0 truncate">{{ joinList(reviewers.map(person => person.name), t) }}</span></p>
    </div>
    <SharedStatusBadge v-if="status" :tone="operationsStateTone(status)" :label="t(`operations.states.${status}`)" />
  </SharedSubCard>
</template>
