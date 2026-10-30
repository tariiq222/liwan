<script setup lang="ts">
import type { HrPlanRunDetail, HrPlanRunStep } from '@liwan/contracts'

// The checklist of one plan run: the server decides `can_complete` (an HR manager or the
// step's assignee), and the completion note is optional.
const props = withDefaults(defineProps<{
  run: HrPlanRunDetail
  namespace: string
  pending?: boolean
}>(), { pending: false })
const emit = defineEmits<{ complete: [stepId: number, feedback?: string] }>()
const { t } = useI18n()
const feedbackFor = ref<number | null>(null)
const feedback = ref('')
const TONES: Record<string, 'success' | 'info' | 'warning' | 'destructive' | 'neutral'> = {
  planned: 'neutral', today: 'info', overdue: 'destructive', done: 'success',
}

function askFeedback(step: HrPlanRunStep) {
  feedbackFor.value = step.id
  feedback.value = ''
}
function markDone(step: HrPlanRunStep) {
  if (props.pending) return
  emit('complete', step.id, feedback.value.trim() || undefined)
  feedbackFor.value = null
}
</script>

<template>
  <div class="min-w-0">
    <SharedPageState v-if="!run.steps.length" :empty="true" :empty-text="t(`${namespace}.run.noSteps`)" />
    <ul v-else class="min-w-0 divide-y divide-default">
      <li v-for="step in run.steps" :key="step.id" class="flex flex-wrap items-start gap-3 py-3">
        <SharedStatusBadge size="sm" :tone="TONES[step.state] ?? 'neutral'" :label="t(`${namespace}.states.${step.state}`)" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-base font-medium text-highlighted">{{ step.summary }}</p>
          <p class="mt-1 text-xs text-muted">
            {{ step.assignee?.name || t(`${namespace}.form.responsibleOther`) }} · <span class="tabular-nums">{{ step.date_deadline }}</span>
          </p>
        </div>
        <div v-if="step.can_complete" class="flex shrink-0 flex-col items-end gap-2">
          <UInput
            v-if="feedbackFor === step.id"
            v-model="feedback"
            class="w-56"
            size="sm"
            :placeholder="t(`${namespace}.run.feedbackPlaceholder`)"
            :aria-label="t(`${namespace}.run.feedbackPlaceholder`)"
            :disabled="pending"
          />
          <div class="flex items-center gap-2">
            <UButton
              v-if="feedbackFor !== step.id"
              type="button"
              color="primary"
              variant="soft"
              size="sm"
              icon="i-lucide-check"
              :disabled="pending"
              :label="t(`${namespace}.actions.complete`)"
              @click="askFeedback(step)"
            />
            <template v-else>
              <UButton type="button" color="primary" size="sm" :loading="pending" :label="t(`${namespace}.actions.complete`)" @click="markDone(step)" />
              <UButton type="button" color="neutral" variant="ghost" size="sm" :disabled="pending" :label="t('app.cancel')" @click="feedbackFor = null" />
            </template>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
