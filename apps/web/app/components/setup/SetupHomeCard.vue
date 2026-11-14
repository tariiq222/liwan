<script setup lang="ts">
import { canUseSetup, handledSteps, SETUP_PATH, SETUP_STEP_COUNT, setupIsOpen } from '@/composables/setup/setupSteps'
import { useSetupProgress } from '@/composables/setup/useSetupProgress'

// A compact card on home while first-run setup is open: "n of 5" and a link to /setup, never a redirect. Only a user
// the route admits asks for the progress at all; a refusal (a branch session) leaves the card out.
const { t } = useI18n()
const { me } = useMe()
const { data: progress } = useSetupProgress(() => canUseSetup(me.value))
</script>

<template>
  <section v-if="setupIsOpen(progress)" :aria-label="t('setup.home.title')" class="flex flex-col gap-4 rounded-card border border-default bg-default p-5 md:flex-row md:items-center md:justify-between" data-testid="setup-home-card">
    <div class="min-w-0">
      <h2 class="text-lg font-semibold text-highlighted">{{ t('setup.home.title') }}</h2>
      <p class="mt-1 text-sm text-muted">{{ t('setup.home.description') }}</p>
      <div class="mt-3 flex items-center gap-3">
        <SharedProgress class="w-40" :value="(handledSteps(progress) / SETUP_STEP_COUNT) * 100" :label="t('setup.progressLabel')" />
        <span class="text-sm font-medium text-highlighted" data-testid="setup-home-progress">{{ t('setup.progress', { done: handledSteps(progress), total: SETUP_STEP_COUNT }) }}</span>
      </div>
    </div>
    <UButton :to="SETUP_PATH" :label="t('setup.home.open')" data-testid="setup-home-open" />
  </section>
</template>
