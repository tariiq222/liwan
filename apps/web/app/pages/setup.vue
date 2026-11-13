<script setup lang="ts">
import type { SetupOutcome, SetupStepKey } from '@liwan/contracts'
import SetupStepItem from '@/components/setup/SetupStepItem.vue'
import { handledSteps, SETUP_STEP_COUNT, setupTargetAccess } from '@/composables/setup/setupSteps'
import { useChangeSetupProgress, useSetupProgress } from '@/composables/setup/useSetupProgress'

// The first-run checklist: five steps, each linking to the page that owns its work, with done and skip, and a finish
// action that closes the wizard. The route is open to whoever holds `settings.company.manage` (the route guard); the
// server refuses a branch, and that refusal shows as the page's error state.
const { t } = useI18n()
const { me, ready } = useMe()
await ready
usePageHeader(() => t('setup.title'))
const hydrated = useHydrated()
const { data: progress, isLoading, error, refetch } = useSetupProgress()
const change = useChangeSetupProgress()
const closed = computed(() => progress.value?.closed_at != null)
const done = computed(() => (progress.value ? handledSteps(progress.value) : 0))
const stepChange = (step: SetupStepKey, outcome: SetupOutcome | null) => change.mutate({ step, outcome })
</script>

<template>
  <SharedPageContainer data-testid="setup-page">
    <SharedPageHeader :title="t('setup.title')" :description="t('setup.description')" icon="i-lucide-list-checks">
      <template #actions>
        <UButton
          v-if="progress"
          :color="closed ? 'neutral' : 'primary'"
          :variant="closed ? 'outline' : 'solid'"
          :label="closed ? t('setup.actions.reopenWizard') : t('setup.actions.finish')"
          :disabled="!hydrated || change.isPending.value"
          data-testid="setup-toggle-closed"
          @click="change.mutate({ closed: !closed })"
        />
      </template>
    </SharedPageHeader>
    <SharedPageState :loading="isLoading" :error="error" @retry="refetch()">
      <template v-if="progress">
        <div class="flex flex-col gap-2" data-testid="setup-progress">
          <p class="text-sm font-medium text-highlighted">{{ t('setup.progress', { done, total: SETUP_STEP_COUNT }) }}</p>
          <SharedProgress :value="(done / SETUP_STEP_COUNT) * 100" size="md" :label="t('setup.progressLabel')" />
        </div>
        <SharedEmptyState v-if="closed" compact :title="t('setup.closed.title')" :description="t('setup.closed.description')" data-testid="setup-closed" />
        <p v-if="change.isError.value" class="text-sm text-error" role="alert" data-testid="setup-failed">{{ t('setup.failed') }}</p>
        <ol class="flex flex-col gap-3" :aria-label="t('setup.title')">
          <SetupStepItem
            v-for="step in progress.steps"
            :key="step.key"
            :step-key="step.key"
            :outcome="step.outcome"
            :access="setupTargetAccess(me, step.key)"
            :busy="change.isPending.value"
            @change="outcome => stepChange(step.key, outcome)"
          />
        </ol>
      </template>
    </SharedPageState>
  </SharedPageContainer>
</template>
