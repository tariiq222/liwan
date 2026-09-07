<script setup lang="ts">
import type { TaskDetail } from '@nasq/contracts'
import { useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import {
  taskKeys,
  useAcceptTaskCompletion,
  useRequestTaskCompletion,
  useReturnTaskCompletion,
  useWithdrawTaskCompletion,
} from '@/composables/useTasks'

const props = defineProps<{ task: TaskDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const qc = useQueryClient()
const note = ref('')
const { mutateAsync: requestCompletion, isPending: requesting } = useRequestTaskCompletion()
const { mutateAsync: acceptCompletion, isPending: accepting } = useAcceptTaskCompletion()
const { mutateAsync: returnCompletion, isPending: returning } = useReturnTaskCompletion()
const { mutateAsync: withdrawCompletion, isPending: withdrawing } = useWithdrawTaskCompletion()
const busy = computed(() => requesting.value || accepting.value || returning.value || withdrawing.value)
const canRequest = computed(() => props.task.allowed_actions.includes('request_completion'))
const canAccept = computed(() => props.task.allowed_actions.includes('accept_completion'))
const canReturn = computed(() => props.task.allowed_actions.includes('return_completion'))
const canWithdraw = computed(() => props.task.allowed_actions.includes('withdraw_completion'))
const blockedReason = computed(() => props.task.completion_blocked_reason)
const showSection = computed(() => {
  if (!props.task.completion_policy || props.task.completion_policy === 'none') return false
  if (!props.task.is_closed) return true
  return Boolean(
    props.task.completion_pending
    || blockedReason.value
    || props.task.completion_return_note
    || canRequest.value
    || canAccept.value
    || canReturn.value
    || canWithdraw.value,
  )
})
const showHint = computed(() => (
  !props.task.is_closed
  && !props.task.completion_pending
  && !blockedReason.value
  && !props.task.completion_return_note
))

async function recover(error: unknown) {
  toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
  await qc.invalidateQueries({ queryKey: taskKeys.detail(props.task.id) })
}

async function request() {
  if (busy.value || !hydrated.value) return
  try {
    await requestCompletion({ id: props.task.id })
  } catch (error) {
    await recover(error)
  }
}

async function accept() {
  if (busy.value || !hydrated.value) return
  try {
    await acceptCompletion({ id: props.task.id, revision: props.task.completion_revision ?? 0 })
  } catch (error) {
    await recover(error)
  }
}

async function returnTask() {
  const trimmed = note.value.trim()
  if (!trimmed || busy.value || !hydrated.value) return
  try {
    await returnCompletion({ id: props.task.id, revision: props.task.completion_revision ?? 0, note: trimmed })
    note.value = ''
  } catch (error) {
    await recover(error)
  }
}

async function withdraw() {
  if (busy.value || !hydrated.value) return
  try {
    await withdrawCompletion({ id: props.task.id, revision: props.task.completion_revision ?? 0 })
  } catch (error) {
    await recover(error)
  }
}
</script>

<template>
  <section v-if="showSection" data-testid="task-completion" class="space-y-3 rounded-lg border p-3">
    <h2 class="text-sm font-medium">{{ t('tasks.completion.title') }}</h2>
    <p
      v-if="blockedReason === 'no_reviewer'"
      class="text-sm text-destructive"
      data-testid="task-completion-blocked"
      role="alert"
    >
      {{ t('tasks.completion.noReviewer') }}
    </p>
    <p
      v-else-if="blockedReason === 'reviewer_ineligible'"
      class="text-sm text-destructive"
      data-testid="task-completion-blocked"
      role="alert"
    >
      {{ t('tasks.completion.reviewerIneligible') }}
    </p>
    <p v-if="task.completion_pending" class="text-sm text-muted-foreground" data-testid="task-completion-pending">
      {{ t('tasks.completion.pending') }}
    </p>
    <p v-if="blockedReason && canWithdraw" class="text-sm text-muted-foreground">
      {{ t('tasks.completion.contactManager') }}
    </p>
    <p v-else-if="task.completion_return_note" class="text-sm text-muted-foreground">{{ t('tasks.completion.returned', { note: task.completion_return_note }) }}</p>
    <p v-else-if="showHint" class="text-sm text-muted-foreground">{{ t('tasks.completion.hint') }}</p>
    <Button
      v-if="canRequest"
      type="button"
      data-testid="task-completion-request"
      :disabled="!hydrated || busy"
      @click="request"
    >
      {{ t('tasks.completion.request') }}
    </Button>
    <Button
      v-if="canWithdraw"
      type="button"
      variant="outline"
      data-testid="task-completion-withdraw"
      :disabled="!hydrated || busy"
      @click="withdraw"
    >
      {{ t('tasks.completion.withdraw') }}
    </Button>
    <Button
      v-if="canAccept"
      type="button"
      data-testid="task-completion-accept"
      :disabled="!hydrated || busy"
      @click="accept"
    >
      {{ t('tasks.completion.accept') }}
    </Button>
    <div v-if="canReturn" class="grid gap-2">
      <Label for="completion-note">{{ t('tasks.completion.note') }}</Label>
      <textarea
        id="completion-note"
        v-model="note"
        data-testid="task-completion-note"
        class="min-h-20 rounded-md border bg-background p-2 text-sm"
        :disabled="!hydrated || busy"
      />
      <Button type="button" variant="outline" data-testid="task-completion-return" :disabled="!hydrated || busy || !note.trim()" @click="returnTask">
        {{ t('tasks.completion.return') }}
      </Button>
    </div>
  </section>
</template>
