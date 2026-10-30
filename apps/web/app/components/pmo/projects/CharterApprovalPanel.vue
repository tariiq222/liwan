<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { CHARTER_RETURN_NOTE_MAX, type ProjectDetail } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { formatLiwanDate } from '@liwan/ui/app/composables/calendarDate'
import { projectKeys } from '@/composables/projectKeys'
import { useCharterTransition } from '@/composables/useProjects'

// The charter's approval state, shown above the charter. Every action goes
// through useCharterTransition, which writes the detail cache, so the page
// re-renders from the new project and this panel needs no emits.
const props = defineProps<{ project: ProjectDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const qc = useQueryClient()
const { mutateAsync: transition, isPending } = useCharterTransition()

const charter = computed(() => props.project.charter)
const state = computed(() => charter.value.state)
const canReview = computed(() => state.value === 'submitted' && charter.value.can_review)
const canWithdraw = computed(() => state.value === 'submitted' && props.project.can_manage && !charter.value.can_review)
const sponsorName = computed(() => charter.value.sponsor?.name ?? '')
const approvedLabel = computed(() => {
  const { approved_by: by, approved_at: at } = charter.value
  return by ? t('projects.charter.approvedBy', { name: by.name, date: formatLiwanDate(at) }) : t('projects.charter.state.approved')
})

const returning = ref(false)
const withdrawing = ref(false)
const note = ref('')
const noteReady = computed(() => note.value.trim().length > 0)

const CHARTER_ACTION_TOAST = {
  approve: 'projects.toast.charterApproved',
  return: 'projects.toast.charterReturned',
  withdraw: 'projects.toast.charterWithdrawn',
} as const

async function run(action: keyof typeof CHARTER_ACTION_TOAST, body?: string) {
  if (!hydrated.value || isPending.value) return
  try {
    await transition({ id: props.project.id, action, expected: props.project.updated_at, note: body })
    returning.value = false
    withdrawing.value = false
    note.value = ''
    toast.add({ title: t(CHARTER_ACTION_TOAST[action]), color: 'success' })
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.code === 'stale_write') {
      toast.add({ title: t('projects.charter.staleReview'), color: 'warning' })
      returning.value = false
      withdrawing.value = false
      void qc.invalidateQueries({ queryKey: projectKeys.detail(props.project.id) })
      return
    }
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  }
}
</script>

<template>
  <div class="liwan-print-hide" data-testid="charter-approval-panel">
    <UAlert v-if="state === 'draft' && charter.return_note" color="warning" variant="subtle" icon="i-lucide-undo-2" data-testid="charter-returned" :title="t('projects.charter.returned')" :description="charter.return_note" />
    <UAlert v-else-if="state === 'draft'" color="warning" variant="subtle" icon="i-lucide-pencil-line" data-testid="charter-draft-banner" :title="t('projects.charter.draftBanner')" />

    <SharedInlineConfirm
      v-else-if="state === 'submitted' && withdrawing"
      color="warning"
      data-testid="charter-withdraw-confirm"
      :title="t('projects.charter.withdrawConfirm')"
      :confirm-label="t('projects.charter.withdraw')"
      :pending="isPending"
      @cancel="withdrawing = false"
      @confirm="run('withdraw')"
    />
    <UAlert v-else-if="state === 'submitted'" color="info" variant="subtle" icon="i-lucide-hourglass" data-testid="charter-submitted" :title="t('projects.charter.waitingFor', { name: sponsorName })">
      <template v-if="returning" #description>
        <UTextarea v-model="note" class="mt-2 w-full" data-testid="charter-return-note" :maxlength="CHARTER_RETURN_NOTE_MAX" :placeholder="t('projects.charter.returnNote')" :aria-label="t('projects.charter.returnNote')" />
      </template>
      <template v-if="canReview || canWithdraw" #actions>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <template v-if="canReview && returning">
            <UButton type="button" color="neutral" variant="outline" data-testid="charter-return-cancel" :disabled="!hydrated || isPending" :label="t('app.cancel')" @click="returning = false" />
            <UButton type="button" data-testid="charter-return-confirm" :disabled="!hydrated || !noteReady" :loading="isPending" :label="t('projects.charter.returnConfirm')" @click="run('return', note.trim())" />
          </template>
          <template v-else-if="canReview">
            <UButton type="button" color="neutral" variant="outline" data-testid="charter-return" :disabled="!hydrated || isPending" :label="t('projects.charter.return')" @click="returning = true" />
            <UButton type="button" data-testid="charter-approve" :disabled="!hydrated" :loading="isPending" :label="t('projects.charter.approve')" @click="run('approve')" />
          </template>
          <UButton v-else type="button" color="neutral" variant="outline" data-testid="charter-withdraw" :disabled="!hydrated || isPending" :label="t('projects.charter.withdraw')" @click="withdrawing = true" />
        </div>
      </template>
    </UAlert>

    <UAlert v-else-if="charter.approved_by" color="success" variant="subtle" icon="i-lucide-badge-check" data-testid="charter-approved" :title="approvedLabel" />
  </div>
</template>
