<script setup lang="ts">
import type { ProjectPhase } from '@liwan/contracts'
import { PHASE_COUNT, PHASE_LABEL_KEY, phaseNumber, phaseSteps } from '@/composables/projectPhase'

// Display only: the five lifecycle steps, current one highlighted. Moves go through ProjectPhaseGate.
const props = defineProps<{ current: ProjectPhase }>()
const { t } = useI18n()
const steps = computed(() => phaseSteps(props.current))
</script>

<template>
  <nav :aria-label="t('projects.phase.title')" data-testid="project-phase-stepper">
    <p class="flex items-center gap-2 text-sm sm:hidden" data-testid="project-phase-compact">
      <span class="font-semibold text-highlighted">{{ t(PHASE_LABEL_KEY[current]) }}</span>
      <span class="tabular-nums text-muted">{{ t('projects.phase.position', { current: phaseNumber(current), total: PHASE_COUNT }) }}</span>
    </p>
    <ol class="hidden flex-wrap items-center gap-x-2 gap-y-1 text-sm sm:flex">
      <li
        v-for="(step, index) in steps"
        :key="step.phase"
        class="flex items-center gap-2"
        :class="step.state === 'current' ? 'font-semibold text-primary' : step.state === 'done' ? 'text-default' : 'text-muted'"
        :aria-current="step.state === 'current' ? 'step' : undefined"
        :data-testid="`project-phase-${step.phase}`"
        :data-state="step.state"
      >
        <span
          class="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums"
          :class="step.state === 'current' ? 'bg-(--primary-solid) text-(--primary-solid-foreground)' : step.state === 'done' ? 'bg-primary/10 text-primary' : 'bg-elevated text-muted'"
          aria-hidden="true"
        >
          <UIcon v-if="step.state === 'done'" name="i-lucide-check" class="size-3.5" />
          <template v-else>{{ index + 1 }}</template>
        </span>
        <span v-if="step.state === 'done'" class="sr-only">{{ t('projects.phase.met') }}: </span>{{ t(PHASE_LABEL_KEY[step.phase]) }}
        <UIcon v-if="index < steps.length - 1" name="i-lucide-chevron-left" class="size-4 text-dimmed ltr:rotate-180" aria-hidden="true" />
      </li>
    </ol>
  </nav>
</template>
