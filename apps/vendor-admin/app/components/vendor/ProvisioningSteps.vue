<script setup lang="ts">
// The stages a shared workspace goes through, as a readable list: done, current (or failed) and still to come.
const props = defineProps<{ stage: string; failed?: boolean }>()
const { t } = useI18n()
const STEPS = ['reserved', 'queued', 'verifying', 'activating', 'active'] as const
const currentIndex = computed(() => {
  const found = STEPS.findIndex(step => step === props.stage)
  return found === -1 ? 0 : found
})
type StepState = 'done' | 'current' | 'failed' | 'pending'
const steps = computed(() => STEPS.map((key, index) => {
  const done = props.stage === 'active' || index < currentIndex.value
  const current = !done && index === currentIndex.value
  const state: StepState = done ? 'done' : current ? (props.failed ? 'failed' : 'current') : 'pending'
  return { key, state }
}))
const ICONS = { done: 'i-lucide-circle-check', current: 'i-lucide-loader-circle', failed: 'i-lucide-circle-x', pending: 'i-lucide-circle' } as const
const ICON_CLASS = { done: 'text-success', current: 'text-info animate-spin motion-reduce:animate-none', failed: 'text-error', pending: 'text-muted' } as const
</script>

<template>
  <ol class="grid gap-2" data-slot="provisioning-steps" :aria-label="t('vendor.tenants.provisioning.progress')">
    <li v-for="step in steps" :key="step.key" class="flex items-center gap-3 text-sm" :aria-current="step.state === 'current' || step.state === 'failed' ? 'step' : undefined" :data-state="step.state">
      <UIcon :name="ICONS[step.state]" class="size-5 shrink-0" :class="ICON_CLASS[step.state]" aria-hidden="true" />
      <span :class="step.state === 'pending' ? 'text-muted' : 'text-highlighted'">{{ t(`vendor.tenants.provisioning.stages.${step.key}`) }}</span>
      <span class="sr-only">{{ t(`vendor.tenants.provisioning.state.${step.state}`) }}</span>
    </li>
  </ol>
</template>
