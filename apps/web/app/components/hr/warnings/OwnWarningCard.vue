<script setup lang="ts">
import type { HrWarning } from '@liwan/contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { hrWarningBadge, ownHrWarningActions } from '@/utils/hrWarnings'

// One warning issued to the signed-in employee. Answering is inline: acknowledge at once, or contest
// with a required note. A required answer that is still missing gets the page's one highlighted card.
const props = defineProps<{ warning: HrWarning; pending?: boolean; error?: string }>()
const emit = defineEmits<{ acknowledge: []; contest: [note: string] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const contesting = ref(false)
const note = ref('')
const actions = computed(() => ownHrWarningActions(props.warning))
const badge = computed(() => hrWarningBadge(props.warning.state))
const missing = computed(() => !note.value.trim())

function sendContest() {
  if (missing.value) return
  emit('contest', note.value.trim())
}
</script>

<template>
  <SharedRecordSection :variant="props.warning.ack_pending ? 'action' : 'panel'" :title="props.warning.type.name" :data-testid="`hr-own-warning-${props.warning.id}`">
    <div class="grid gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <SharedStatusBadge size="sm" :tone="badge.tone" :label="t(badge.labelKey)" data-testid="hr-own-warning-state" />
        <SharedStatusBadge v-if="props.warning.ack_pending" size="sm" tone="warning" :label="t('hrWarnings.mine.pending')" data-testid="hr-own-warning-pending" />
        <span class="tabular-nums text-sm text-muted">{{ formatDate(props.warning.date_issued) }}</span>
      </div>
      <p class="whitespace-pre-line">{{ props.warning.reason }}</p>
      <div v-if="props.warning.corrective_action">
        <p class="text-xs font-semibold text-muted">{{ t('hrWarnings.detail.corrective') }}</p>
        <p class="whitespace-pre-line">{{ props.warning.corrective_action }}</p>
      </div>
      <div v-if="props.warning.contest_note">
        <p class="text-xs font-semibold text-muted">{{ t('hrWarnings.mine.yourNote') }}</p>
        <p class="whitespace-pre-line">{{ props.warning.contest_note }}</p>
      </div>
      <UAlert v-if="props.error" role="alert" color="error" variant="subtle" :title="t('hrWarnings.mine.error')" :description="props.error" />
      <SharedInlineConfirm
        v-if="contesting"
        :title="t('hrWarnings.mine.contestTitle')"
        :confirm-label="t('hrWarnings.mine.contestSubmit')"
        color="warning"
        :pending="props.pending"
        :disabled="missing"
        @confirm="sendContest"
        @cancel="contesting = false"
      >
        <UFormField :label="t('hrWarnings.mine.contestNote')" :for="`hr-own-warning-note-${props.warning.id}`" class="mt-2">
          <UTextarea :id="`hr-own-warning-note-${props.warning.id}`" v-model="note" class="w-full" :rows="3" :disabled="props.pending" data-testid="hr-own-warning-note" />
        </UFormField>
      </SharedInlineConfirm>
      <div v-else-if="actions.acknowledge || actions.contest" class="flex flex-wrap gap-2">
        <UButton v-if="actions.acknowledge" color="primary" :disabled="!hydrated || props.pending" :loading="props.pending" :label="t('hrWarnings.mine.acknowledge')" data-testid="hr-own-warning-acknowledge" @click="emit('acknowledge')" />
        <UButton v-if="actions.contest" color="neutral" variant="outline" :disabled="!hydrated || props.pending" :label="t('hrWarnings.mine.contest')" data-testid="hr-own-warning-contest" @click="contesting = true" />
      </div>
    </div>
  </SharedRecordSection>
</template>
