<script setup lang="ts">
import type { IntegrationConnection } from '@liwan/contracts'
import { guideSteps, type GuideState } from '@/utils/integrationGuide'

// The step guide for connecting a provider (WhatsApp through Meta, Twilio). Its steps and texts come from the provider
// code and the locale keys under `integrations.guide.<code>`. Before the account is saved it only teaches; after, a
// step that can be checked shows what the stored connection really reports (its state, the checked time and which
// secrets are present) and the rest says it cannot be checked from here. Nothing here calls the provider or the server.
const props = defineProps<{ code: string, connection?: IntegrationConnection }>()
const { t } = useI18n()

const TONES: Record<GuideState, 'success' | 'destructive' | 'warning' | 'neutral'> = { todo: 'neutral', done: 'success', problem: 'destructive', pending: 'warning', unchecked: 'neutral' }
const steps = computed(() => guideSteps(props.code, props.connection))
const base = computed(() => `integrations.guide.${props.code}`)
</script>

<template>
  <SharedRecordSection id="guide" variant="panel" :title="t(`${base}.title`)" :description="t(`${base}.hint`)" data-testid="integration-guide">
    <ol class="grid gap-4 text-start">
      <li v-for="(step, index) in steps" :key="step.key" class="flex min-w-0 gap-3" :data-testid="`integration-guide-step-${step.key}`">
        <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-sm font-semibold text-highlighted" :aria-label="t('integrations.guide.stepLabel', { n: index + 1 })">{{ index + 1 }}</span>
        <div class="grid min-w-0 gap-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-medium text-highlighted">{{ t(`${base}.steps.${step.key}.title`) }}</h3>
            <SharedStatusBadge v-if="step.state" size="sm" :tone="TONES[step.state]" :label="t(`integrations.guide.state.${step.state}`)" :data-testid="`integration-guide-state-${step.key}`" />
          </div>
          <p class="text-sm text-muted">{{ t(`${base}.steps.${step.key}.body`) }}</p>
          <ul v-if="step.lines.length" class="grid gap-1 text-sm text-muted">
            <li v-for="line in step.lines" :key="line">{{ t(`${base}.steps.${step.key}.${line}`) }}</li>
          </ul>
          <p v-if="step.note" class="text-sm text-muted">{{ t(`${base}.steps.${step.key}.${step.note}`) }}</p>
          <ul v-if="step.codes" class="flex flex-wrap gap-1.5" dir="ltr" :aria-label="step.codes.label ? t(`${base}.${step.codes.label}`) : undefined">
            <li v-for="item in step.codes.items" :key="item"><code class="rounded-md bg-elevated px-1.5 py-0.5 text-xs text-default">{{ item }}</code></li>
          </ul>
          <p v-if="step.result" class="text-sm text-default" :data-testid="`integration-guide-result-${step.key}`">{{ t(`${base}.result.${step.result}`) }}</p>
        </div>
      </li>
    </ol>
  </SharedRecordSection>
</template>
