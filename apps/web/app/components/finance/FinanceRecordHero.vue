<script setup lang="ts">
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

/** One fact of the hero's meta line: its label is read by screen readers only, an empty value leaves the fact out. */
export interface FinanceHeroFact {
  icon: `i-lucide-${string}`
  label: string
  value: string | null | undefined
}

// The identity block of a finance record page (`#summary` of SharedRecordPage): the document number or name as its
// title and the party and date as its meta line, tinted by the record's state tone.
const props = defineProps<{ icon: `i-lucide-${string}`; tone: StatusTone; title: string; facts: FinanceHeroFact[] }>()
const HERO_TONE = { neutral: 'neutral', info: 'info', warning: 'warning', success: 'success', destructive: 'danger', primary: 'info' } as const
const shown = computed(() => props.facts.filter(fact => fact.value))
</script>

<template>
  <SharedRecordHero :icon="props.icon" :tone="HERO_TONE[props.tone]">
    <template #title><bdi>{{ props.title }}</bdi></template>
    <template v-if="shown.length" #meta>
      <span v-for="fact in shown" :key="fact.label" class="inline-flex items-center gap-1.5">
        <UIcon :name="fact.icon" class="size-4 shrink-0" aria-hidden="true" />
        <span class="sr-only">{{ fact.label }}</span>
        <bdi class="tabular-nums">{{ fact.value }}</bdi>
      </span>
    </template>
  </SharedRecordHero>
</template>
