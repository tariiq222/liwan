<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { CHANGE_NOTE_MAX, type ProjectChange } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { changeKeys } from '@/composables/projectChangeKeys'
import { useProjectChangeAction, type ChangeAction } from '@/composables/useProjectChanges'
import { formatLiwanDate } from '@liwan/ui/app/composables/calendarDate'

// The actions of one change request, each confirmed inline (DESIGN.md: no dialogs). Approving takes an optional
// note, rejecting needs one. Every action answers with the new request, which the detail cache takes.
const props = defineProps<{ item: ProjectChange }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const qc = useQueryClient()
const { mutateAsync: act, isPending } = useProjectChangeAction()

type Confirming = 'approve' | 'reject' | 'withdraw' | 'implement' | null
const confirming = ref<Confirming>(null)
const note = ref('')
const noteMissing = computed(() => confirming.value === 'reject' && !note.value.trim())
const askForNote = computed(() => confirming.value === 'approve' || confirming.value === 'reject')

const TOAST = {
  submit: 'projects.changes.toast.submitted',
  withdraw: 'projects.changes.toast.withdrawn',
  approve: 'projects.changes.toast.approved',
  reject: 'projects.changes.toast.rejected',
  implement: 'projects.changes.toast.implemented',
} as const satisfies Record<ChangeAction, string>

function close() {
  confirming.value = null
  note.value = ''
}

async function run(action: ChangeAction) {
  if (!hydrated.value || isPending.value) return
  try {
    await act({ projectId: props.item.project_id, id: props.item.id, action, expected: props.item.updated_at, note: note.value.trim() || undefined })
    close()
    toast.add({ title: t(TOAST[action]), color: 'success' })
  }
  catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      toast.add({ title: t(error.code === 'stale_write' ? 'projects.changes.stale' : 'projects.changes.stateChanged'), color: 'warning' })
      close()
      void qc.invalidateQueries({ queryKey: changeKeys.all(props.item.project_id) })
      return
    }
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  }
}

const decidedLabel = computed(() => {
  const { decided_by: by, decided_at: at } = props.item
  return by ? t(`projects.changes.decidedBy.${props.item.state === 'rejected' ? 'rejected' : 'approved'}`, { name: by.name, date: formatLiwanDate(at) }) : ''
})
</script>

<template>
  <div class="liwan-print-hide grid gap-3" data-testid="change-decision-panel">
    <SharedInlineConfirm
      v-if="confirming"
      :color="confirming === 'reject' || confirming === 'withdraw' ? 'error' : 'primary'"
      :data-testid="`change-${confirming}-confirm`"
      :title="t(`projects.changes.confirm.${confirming}`)"
      :confirm-label="t(`projects.changes.actions.${confirming}`)"
      :pending="isPending"
      :disabled="noteMissing"
      @cancel="close"
      @confirm="run(confirming)"
    >
      <UFormField v-if="askForNote" class="mt-2" :label="t(confirming === 'reject' ? 'projects.changes.noteRequired' : 'projects.changes.noteOptional')" :required="confirming === 'reject'">
        <UTextarea v-model="note" class="w-full" data-testid="change-decision-note" :maxlength="CHANGE_NOTE_MAX" :rows="3" :disabled="isPending" />
      </UFormField>
    </SharedInlineConfirm>

    <UAlert v-else-if="item.state === 'submitted' && item.can_decide" color="info" variant="subtle" icon="i-lucide-hourglass" data-testid="change-awaiting-you" :title="t('projects.changes.awaitingYou')">
      <template #actions>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" data-testid="change-reject" :disabled="!hydrated" :label="t('projects.changes.actions.reject')" @click="confirming = 'reject'" />
          <UButton type="button" data-testid="change-approve" :disabled="!hydrated" :label="t('projects.changes.actions.approve')" @click="confirming = 'approve'" />
        </div>
      </template>
    </UAlert>
    <UAlert v-else-if="item.state === 'submitted'" color="info" variant="subtle" icon="i-lucide-hourglass" data-testid="change-waiting" :title="t('projects.changes.waiting')" />
    <UAlert v-else-if="item.state === 'draft' && item.can_edit" color="warning" variant="subtle" icon="i-lucide-pencil-line" data-testid="change-draft-banner" :title="t('projects.changes.draftBanner')" />
    <UAlert v-else-if="item.state === 'approved'" color="success" variant="subtle" icon="i-lucide-badge-check" data-testid="change-approved" :title="decidedLabel" :description="item.decision_note || undefined" />
    <UAlert v-else-if="item.state === 'rejected'" color="error" variant="subtle" icon="i-lucide-circle-x" data-testid="change-rejected" :title="decidedLabel" :description="item.decision_note || undefined" />
    <UAlert v-else-if="item.state === 'implemented'" color="success" variant="subtle" icon="i-lucide-circle-check-big" data-testid="change-implemented" :title="t('projects.changes.implementedAt', { date: formatLiwanDate(item.implemented_at) })" :description="item.decision_note || undefined" />
    <UAlert v-else-if="item.state === 'withdrawn'" color="neutral" variant="subtle" icon="i-lucide-undo-2" data-testid="change-withdrawn" :title="t('projects.changes.withdrawnBanner')" />

    <div v-if="!confirming && (item.can_submit || item.can_withdraw || item.can_implement)" class="flex flex-wrap justify-end gap-2">
      <UButton v-if="item.can_withdraw" type="button" color="neutral" variant="outline" data-testid="change-withdraw" :disabled="!hydrated || isPending" :label="t('projects.changes.actions.withdraw')" @click="confirming = 'withdraw'" />
      <UButton v-if="item.can_submit" type="button" data-testid="change-submit" :disabled="!hydrated" :loading="isPending" :label="t('projects.changes.actions.submit')" @click="run('submit')" />
      <UButton v-if="item.can_implement" type="button" data-testid="change-implement" :disabled="!hydrated" :label="t('projects.changes.actions.implement')" @click="confirming = 'implement'" />
    </div>
  </div>
</template>
