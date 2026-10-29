<script setup lang="ts">
import type { InboxFlow } from '@webvue/contracts'
import { FLOW_LIMITS, flowResponsesRoute } from '@/composables/inbox/inboxFlow'
import {
  useCopyInboxFlow, useDeleteInboxFlow, useDeprecateInboxFlow, useInboxFlowPreviewLink, usePublishInboxFlow,
} from '@/composables/inbox/useInboxFlows'

// What a manager does with a form beyond editing it: open Meta's preview, publish (irreversible), deprecate, copy (the
// only way to change a published form) and delete a draft. Each destructive or irreversible step is confirmed inline,
// one at a time. Publishing waits for a saved form with no problem Meta found.
const props = defineProps<{ flow: InboxFlow; dirty?: boolean }>()
const emit = defineEmits<{ copied: [flow: InboxFlow]; deleted: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { can } = useAccess()
const manage = computed(() => can('inbox.flows.manage'))
const { mutate: openPreview, isPending: previewing } = useInboxFlowPreviewLink()
const { mutate: publish, isPending: publishing } = usePublishInboxFlow()
const { mutate: deprecate, isPending: deprecating } = useDeprecateInboxFlow()
const { mutate: copy, isPending: copying } = useCopyInboxFlow()
const { mutate: remove, isPending: removing } = useDeleteInboxFlow(() => props.flow.channel.id)

type Step = 'publish' | 'deprecate' | 'copy' | 'delete'
const step = ref<Step | null>(null)
const copyName = ref('')
const replace = ref(true)
const busy = computed(() => previewing.value || publishing.value || deprecating.value || copying.value || removing.value)
const isDraft = computed(() => props.flow.status === 'draft')
const isPublished = computed(() => props.flow.status === 'published')
const canPublish = computed(() => isDraft.value && props.flow.editable && !props.dirty && props.flow.error_count === 0)
const publishBlocker = computed(() => props.dirty ? 'dirty' : props.flow.error_count > 0 ? 'errors' : null)
const off = computed(() => !hydrated.value || busy.value)

function ask(next: Step) {
  step.value = next
  if (next === 'copy') {
    copyName.value = t('inbox.flows.lifecycle.copyName', { name: props.flow.name }).slice(0, FLOW_LIMITS.name)
    replace.value = isPublished.value
  }
}
const fail = (e: unknown) => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })

function preview() {
  openPreview(props.flow.id, { onSuccess: link => window.open(link.url, '_blank', 'noopener,noreferrer'), onError: fail })
}
function confirmPublish() {
  publish(props.flow.id, { onSuccess: () => { step.value = null; toast.add({ title: t('inbox.flows.lifecycle.published'), color: 'success' }) }, onError: fail })
}
function confirmDeprecate() {
  deprecate(props.flow.id, { onSuccess: () => { step.value = null; toast.add({ title: t('inbox.flows.lifecycle.deprecated'), color: 'success' }) }, onError: fail })
}
function confirmCopy() {
  const name = copyName.value.trim()
  if (!name) return
  copy({ id: props.flow.id, body: { name, replace: isPublished.value && replace.value } }, {
    onSuccess: (flow) => { step.value = null; toast.add({ title: t('inbox.flows.lifecycle.copied'), color: 'success' }); emit('copied', flow) },
    onError: fail,
  })
}
function confirmDelete() {
  remove(props.flow.id, { onSuccess: () => emit('deleted'), onError: fail })
}
defineExpose({ step, ask, confirmPublish, confirmCopy, copyName, replace, canPublish })
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('inbox.flows.lifecycle.title')" :description="t('inbox.flows.lifecycle.hint')" data-testid="inbox-flow-lifecycle">
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <UButton v-if="manage" type="button" color="neutral" variant="outline" icon="i-lucide-eye" :loading="previewing" :disabled="off || !props.flow.provider_flow_id" :label="t('inbox.flows.lifecycle.preview')" data-testid="inbox-flow-preview-link" @click="preview" />
        <UButton :to="flowResponsesRoute(props.flow.id)" color="neutral" variant="outline" icon="i-lucide-table" :label="t('inbox.flows.responses.open', { n: props.flow.submission_count })" data-testid="inbox-flow-responses-link" />
        <UButton v-if="manage && isDraft && props.flow.editable" type="button" icon="i-lucide-rocket" :disabled="off || !canPublish || step !== null" :label="t('inbox.flows.lifecycle.publish')" data-testid="inbox-flow-publish" @click="ask('publish')" />
        <UButton v-if="manage && props.flow.supported" type="button" color="neutral" variant="outline" icon="i-lucide-copy" :disabled="off || step !== null" :label="t('inbox.flows.lifecycle.copy')" data-testid="inbox-flow-copy" @click="ask('copy')" />
        <UButton v-if="manage && isPublished" type="button" color="warning" variant="outline" icon="i-lucide-archive" :disabled="off || step !== null" :label="t('inbox.flows.lifecycle.deprecate')" data-testid="inbox-flow-deprecate" @click="ask('deprecate')" />
        <UButton v-if="manage && isDraft" type="button" color="error" variant="outline" icon="i-lucide-trash-2" :disabled="off || step !== null" :label="t('inbox.flows.lifecycle.delete')" data-testid="inbox-flow-delete" @click="ask('delete')" />
      </div>
      <p v-if="manage && isDraft && publishBlocker" class="text-xs text-muted" data-testid="inbox-flow-publish-blocker">{{ t(`inbox.flows.lifecycle.blocker.${publishBlocker}`) }}</p>

      <SharedInlineConfirm
        v-if="step === 'publish'"
        color="warning"
        :title="t('inbox.flows.lifecycle.publishTitle', { name: props.flow.name })"
        :description="t('inbox.flows.lifecycle.publishDescription')"
        :confirm-label="t('inbox.flows.lifecycle.publish')"
        :pending="publishing"
        @confirm="confirmPublish"
        @cancel="step = null"
      />
      <SharedInlineConfirm
        v-else-if="step === 'deprecate'"
        :title="t('inbox.flows.lifecycle.deprecateTitle', { name: props.flow.name })"
        :description="t('inbox.flows.lifecycle.deprecateDescription')"
        :confirm-label="t('inbox.flows.lifecycle.deprecate')"
        :pending="deprecating"
        @confirm="confirmDeprecate"
        @cancel="step = null"
      />
      <SharedInlineConfirm
        v-else-if="step === 'delete'"
        :title="t('inbox.flows.lifecycle.deleteTitle', { name: props.flow.name })"
        :description="t('inbox.flows.lifecycle.deleteDescription')"
        :confirm-label="t('inbox.flows.lifecycle.delete')"
        :pending="removing"
        @confirm="confirmDelete"
        @cancel="step = null"
      />
      <SharedInlineConfirm
        v-else-if="step === 'copy'"
        color="primary"
        :title="t('inbox.flows.lifecycle.copyTitle', { name: props.flow.name })"
        :description="t('inbox.flows.lifecycle.copyDescription')"
        :confirm-label="t('inbox.flows.lifecycle.copy')"
        :pending="copying"
        :disabled="!copyName.trim()"
        @confirm="confirmCopy"
        @cancel="step = null"
      >
        <div class="mt-2 flex flex-col gap-3">
          <UFormField :label="t('inbox.flows.form.name')" required>
            <UInput v-model="copyName" class="w-full" :maxlength="FLOW_LIMITS.name" :disabled="copying" data-testid="inbox-flow-copy-name" />
          </UFormField>
          <label v-if="isPublished" class="flex items-start gap-3 text-sm">
            <USwitch v-model="replace" class="mt-0.5" :disabled="copying" data-testid="inbox-flow-copy-replace" />
            <span><span class="block font-medium text-highlighted">{{ t('inbox.flows.lifecycle.replace') }}</span><span class="block text-xs text-muted">{{ t('inbox.flows.lifecycle.replaceHint') }}</span></span>
          </label>
        </div>
      </SharedInlineConfirm>
    </div>
  </SharedRecordSection>
</template>
