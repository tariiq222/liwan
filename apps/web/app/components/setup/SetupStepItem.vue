<script setup lang="ts">
import type { SetupOutcome, SetupStepKey } from '@liwan/contracts'
import type { SetupTargetAccess } from '@/composables/setup/setupSteps'

// One step of the first-run checklist: what it is for, its state, the one action that opens the page that owns the work
// (or a plain note and no link when that page is not available), then done, skip, or back to to do.
const props = defineProps<{ stepKey: SetupStepKey; outcome: SetupOutcome | null; access: SetupTargetAccess; busy: boolean }>()
const emit = defineEmits<{ change: [outcome: SetupOutcome | null] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const state = computed(() => props.outcome ?? 'todo')
const TONES = { todo: 'neutral', done: 'success', skipped: 'warning' } as const
const ICONS = { todo: 'i-lucide-circle', done: 'i-lucide-circle-check', skipped: 'i-lucide-circle-slash' } as const
const note = computed(() => (props.access.kind === 'open' ? null : t(`setup.notes.${props.access.kind}`)))
</script>

<template>
  <li :data-testid="`setup-step-${props.stepKey}`" :data-state="state" class="flex flex-col gap-4 rounded-card border border-default bg-default p-5 md:flex-row md:items-center md:justify-between">
    <div class="flex min-w-0 items-start gap-3">
      <UIcon :name="ICONS[state]" class="mt-0.5 size-5 shrink-0" :class="props.outcome === 'done' ? 'text-success' : 'text-muted'" aria-hidden="true" />
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-base font-semibold text-highlighted">{{ t(`setup.steps.${props.stepKey}.title`) }}</h2>
          <SharedStatusBadge :tone="TONES[state]" :label="t(`setup.state.${state}`)" size="sm" data-testid="setup-step-state" />
        </div>
        <p class="mt-1 text-sm text-muted">{{ t(`setup.steps.${props.stepKey}.purpose`) }}</p>
        <p v-if="note && props.outcome === null" class="mt-1 text-sm text-warning" data-testid="setup-step-note">{{ note }}</p>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <UButton v-if="props.access.kind === 'open'" :to="props.access.to" color="neutral" variant="outline" :label="t(`setup.steps.${props.stepKey}.action`)" data-testid="setup-step-open" />
      <template v-if="props.outcome === null">
        <UButton color="primary" variant="soft" :label="t('setup.actions.done')" :disabled="!hydrated || props.busy" data-testid="setup-step-done" @click="emit('change', 'done')" />
        <UButton color="neutral" variant="ghost" :label="t('setup.actions.skip')" :disabled="!hydrated || props.busy" data-testid="setup-step-skip" @click="emit('change', 'skipped')" />
      </template>
      <UButton v-else color="neutral" variant="ghost" :label="t('setup.actions.reopen')" :disabled="!hydrated || props.busy" data-testid="setup-step-reopen" @click="emit('change', null)" />
    </div>
  </li>
</template>
