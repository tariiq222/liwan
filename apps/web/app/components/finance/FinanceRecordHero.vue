<script setup lang="ts">
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'
import Money from './invoices/Money.vue'

/** The one figure a finance record turns on, when it has one: what is still owed, or its total. */
export interface FinanceHeroAmount {
  /** What the figure is, e.g. "what is still owed" or "the total"; it names the number beside it. */
  label: string
  value: number
  currency: string
}

// The identity block of a finance record page (`#summary` of SharedRecordPage): the document number or name as its
// title, and its state and one amount as its operational line, tinted by the record's state tone. The party, dates,
// journal and period stay in the aside's properties, so the hero repeats none of them.
const props = defineProps<{
  icon: `i-lucide-${string}`
  tone: StatusTone
  title: string
  /** The record's state in the reader's words, drawn as its status pill. */
  status: string
  /** The figure that matters on this record; a budget has no single amount and leaves it out. */
  amount?: FinanceHeroAmount | null
}>()
const HERO_TONE = { neutral: 'neutral', info: 'info', warning: 'warning', success: 'success', destructive: 'danger', primary: 'info' } as const
</script>

<template>
  <SharedRecordHero :icon="props.icon" :tone="HERO_TONE[props.tone]">
    <template #title><bdi>{{ props.title }}</bdi></template>
    <template #meta>
      <SharedStatusBadge size="sm" :tone="props.tone" :label="props.status" />
      <span v-if="props.amount" class="inline-flex items-baseline gap-1.5">
        <span class="text-muted">{{ props.amount.label }}</span>
        <Money class="font-semibold text-highlighted" :amount="props.amount.value" :currency="props.amount.currency" />
      </span>
    </template>
  </SharedRecordHero>
</template>
