<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import type { OperationAction } from '@liwan/contracts'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import OperationStepRow from '@/components/operations/OperationStepRow.vue'
import { operationsStateTone } from '@/composables/operations/state'
import { statusTag } from '@liwan/ui/app/utils/pageHeaderTag'
import { useOperationRequest, useOperationRequestMutation } from '@/composables/operations/useOperations'
import { createOperationSubmitGuard, operationAttachmentBody, operationErrorKey, operationId } from '@/composables/operations/forms'
const props = defineProps<{ personal?: boolean }>()
const basePath = computed(() => props.personal ? '/account/requests' : '/operations')
const route = useRoute()
const router = useRouter()
const sourcePaths = useRecordListPaths(() => props.personal ? ['/account/requests', '/account'] : ['/operations', '/operations/pending', '/operations/monitoring'])
const { t, locale } = useI18n()
const hydrated = useHydrated()
const id = computed(() => operationId(route.params.id))
const query = useOperationRequest(id, !!props.personal)
const record = query.data
const mutation = useOperationRequestMutation()
const gate = createOperationSubmitGuard()
const pending = gate.pending
const disabled = computed(() => !hydrated.value || pending.value)
const selected = ref<OperationAction | null>(null)
const selectedRevision = ref(0)
const comment = ref('')
const attempted = ref(false)
const error = ref<unknown>(null)
const removal = ref<number | null>(null)
const fileField = ref<{ reset: () => void } | null>(null)
const backTo = computed(() => router.resolve(owningListBack(route.query, sourcePaths.value, route.hash)).fullPath)
// The request's state and process sit in the heading as tags.
const headerTags = computed(() => record.value
  ? [statusTag({ tone: operationsStateTone(record.value.state), label: t(`operations.states.${record.value.state}`) }), { label: record.value.process.name, icon: 'i-lucide-workflow', kind: 'category' as const }]
  : [])
const actions: OperationAction[] = ['submit', 'approve', 'reject', 'return', 'withdraw']
const visibleActions = computed(() => actions.filter(action => record.value?.allowed_actions[action] && (!props.personal || action === 'submit' || action === 'withdraw')))
const commentRequired = computed(() => selected.value === 'reject' || selected.value === 'return')
function choose(action: OperationAction) {
  if (disabled.value || !record.value?.allowed_actions[action]) return
  selected.value = action; selectedRevision.value = record.value.revision; comment.value = ''; attempted.value = false; error.value = null; removal.value = null
}
function cancel() { selected.value = null; removal.value = null; comment.value = ''; attempted.value = false }
async function confirmDecision() {
  if (disabled.value || !selected.value || !record.value?.allowed_actions[selected.value]) return
  attempted.value = true
  if (commentRequired.value && !comment.value.trim()) return
  const action = selected.value
  await gate.run(async () => {
    try {
      await mutation.mutateAsync({ action, id: record.value!.id, body: { revision: selectedRevision.value, ...(action !== 'submit' && comment.value.trim() ? { comment: comment.value.trim() } : {}) } })
      cancel(); error.value = null
    } catch (e) { error.value = e }
  })
}
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || disabled.value || !record.value?.allowed_actions.edit) return
  await gate.run(async () => { try { const body = await operationAttachmentBody(file); await mutation.mutateAsync({ action: 'attach', id: record.value!.id, body }); error.value = null } catch (e) { error.value = e } finally { fileField.value?.reset() } })
}
async function removeAttachment() {
  if (disabled.value || !record.value?.allowed_actions.edit || removal.value === null) return
  const attachmentId = removal.value
  await gate.run(async () => { try { await mutation.mutateAsync({ action: 'removeAttachment', id: record.value!.id, attachmentId }); removal.value = null; error.value = null } catch (e) { error.value = e } })
}
async function refresh() { if (disabled.value) return; cancel(); error.value = null; await query.refetch() }
function date(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : formatDateTime(parsed) }
const reviewing = computed(() => !!record.value && (record.value.allowed_actions.approve || record.value.allowed_actions.reject || record.value.allowed_actions.return))
const eventKinds = ['submitted', 'approved', 'rejected', 'returned', 'withdrawn', 'executed', 'execution_failed']
</script>
<template>
  <SharedRecordPage
    :title="record?.name ?? t('operations.request')"
    :tags="headerTags"
    :back-to="backTo"
    :back-label="t(personal ? 'operations.personal.title' : `operations.nav.${backTo.startsWith('/operations/pending') ? 'pending' : backTo.startsWith('/operations/monitoring') ? 'monitoring' : 'mine'}`)"
    :loading="id !== null && query.isPending.value"
    :error="id === null ? { status: 404 } : query.error.value"
    @retry="hydrated && query.refetch()"
  >
    <template v-if="record?.allowed_actions.edit" #actions><UButton color="neutral" variant="outline" :disabled="disabled" :to="recordChildTo(`${basePath}/${record.id}/edit`, route.query, sourcePaths, route.hash)" :label="t('operations.edit')" /></template>
    <template v-if="record">
      <SharedUnsavedChanges :dirty="!!comment.trim()" />
      <UAlert v-if="error" role="alert" color="error" :title="t(`operations.errors.${operationErrorKey(error)}`)"><template #actions><UButton color="neutral" variant="outline" :disabled="disabled" :label="t('operations.refresh')" @click="refresh" /></template></UAlert>
      <SharedRecordSection v-if="visibleActions.length" variant="action" :title="t(reviewing ? 'operations.decisionNeeded' : 'operations.nextStep')">
        <div class="space-y-4">
          <div class="flex flex-wrap items-center gap-2"><UButton v-for="action in visibleActions" :key="action" :disabled="disabled" :color="action === 'reject' || action === 'withdraw' ? 'error' : action === 'approve' || action === 'submit' ? 'primary' : 'neutral'" :variant="action === 'approve' || action === 'submit' ? 'solid' : 'outline'" :label="t(`operations.actions.${action}`)" @click="choose(action)" /></div>
          <SharedInlineConfirm v-if="selected" :title="t(`operations.confirm.${selected}`)" :description="t(selected === 'approve' ? 'operations.approveHelp' : selected === 'submit' ? 'operations.submitHelp' : 'operations.reasonHelp')" :confirm-label="t(`operations.actions.${selected}`)" :color="selected === 'reject' || selected === 'withdraw' ? 'error' : 'primary'" :pending="pending" :disabled="disabled" @confirm="confirmDecision" @cancel="cancel">
            <UFormField v-if="selected !== 'submit'" name="comment" :label="t('operations.comment')" :required="commentRequired" :error="attempted && commentRequired && !comment.trim() ? t('operations.errors.required') : undefined"><UTextarea v-model="comment" class="w-full" :rows="3" :disabled="disabled" :maxlength="4000" /></UFormField>
          </SharedInlineConfirm>
        </div>
      </SharedRecordSection>
      <SharedRecordSection variant="panel" :title="t('operations.description')">
        <p class="whitespace-pre-wrap text-sm leading-7">{{ record.description || t('operations.noDescription') }}</p>
        <UButton v-if="record.target" color="neutral" variant="link" class="mt-2 p-0" :disabled="disabled" :to="record.target.href" :label="record.target.name" icon="i-lucide-external-link" />
      </SharedRecordSection>
      <SharedRecordSection variant="panel" :title="t('operations.stages')">
        <p v-if="!record.steps.length" class="text-sm text-muted">{{ t('operations.stagesAfterSubmit') }}</p>
        <ol v-else class="space-y-3"><OperationStepRow v-for="step in record.steps" :key="step.sequence" :number="step.sequence" :name="step.name" :reviewers="step.reviewers" :status="step.status" /></ol>
      </SharedRecordSection>
      <SharedRecordSection variant="panel" :title="t('operations.attachments')">
        <div class="space-y-3">
          <SharedFileField v-if="record.allowed_actions.edit" ref="fileField" :disabled="disabled || selected !== null || removal !== null" :aria-label="t('operations.addAttachment')" @change="upload" />
          <p v-if="!record.attachments.length" class="text-sm text-muted">{{ t('operations.noAttachments') }}</p>
          <ul v-else class="divide-y divide-default"><li v-for="attachment in record.attachments" :key="attachment.id" class="flex min-w-0 items-center justify-between gap-2 py-2"><UButton :to="attachment.url" target="_blank" color="neutral" variant="link" class="min-w-0 text-start" :disabled="disabled" :label="attachment.name" icon="i-lucide-paperclip" /><UButton v-if="record.allowed_actions.edit" color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="t('operations.removeAttachment')" :disabled="disabled" @click="cancel(); removal = attachment.id" /></li></ul>
          <SharedInlineConfirm v-if="removal !== null" :title="t('operations.removeAttachment')" :confirm-label="t('operations.remove')" :pending="pending" :disabled="disabled" @confirm="removeAttachment" @cancel="removal = null" />
        </div>
      </SharedRecordSection>
      <SharedRecordSection variant="list" :title="t('operations.history')">
        <p v-if="!record.events.length" class="p-(--liwan-card-pad) text-sm text-muted">{{ t('operations.noHistory') }}</p>
        <ol v-else class="divide-y divide-default"><li v-for="event in record.events" :key="event.id" class="space-y-1 px-(--liwan-card-pad) py-3"><div class="flex flex-wrap items-center justify-between gap-2"><span class="flex items-center gap-2 text-sm font-medium"><SharedPersonAvatar :people="[event.actor]" />{{ t(`operations.events.${eventKinds.includes(event.kind) ? event.kind : 'updated'}`) }} · {{ event.actor.name }}</span><time class="text-sm text-muted" :datetime="event.created_at">{{ date(event.created_at) }}</time></div><p v-if="event.comment" class="whitespace-pre-wrap text-sm">{{ event.comment }}</p></li></ol>
      </SharedRecordSection>
    </template>
    <template v-if="record" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('operations.requester')"><span class="inline-flex items-center gap-2"><SharedPersonAvatar :people="[record.requester]" />{{ record.requester.name }}</span></SharedPropertyRow>
        <SharedPropertyRow :label="t('operations.createdAt')"><time :datetime="record.created_at">{{ date(record.created_at) }}</time></SharedPropertyRow>
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
