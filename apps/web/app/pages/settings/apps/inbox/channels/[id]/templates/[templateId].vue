<script setup lang="ts">
import { statusTag } from '@webvue/ui/app/utils/pageHeaderTag'
import { TEMPLATE_CATEGORY_TONE, TEMPLATE_STATUS_TONE, templatesRoute } from '@/composables/inbox/inboxTemplate'
import { useDeleteInboxTemplate, useInboxTemplate } from '@/composables/inbox/useInboxSettings'

// One template: its builder with the live preview (read-only when Meta takes no edit in its status), the review status
// and quality in the header, the reason Meta gave for a rejection, and an inline-confirmed delete.
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { can } = useAccess()
const positive = (value: unknown) => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}
const channelId = computed(() => positive(route.params.id))
const templateId = computed(() => positive(route.params.templateId))
const backTo = computed(() => templatesRoute(channelId.value ?? 0, route.query))
const query = useInboxTemplate(templateId)
const template = query.data
const { mutate: remove, isPending: removing } = useDeleteInboxTemplate(() => channelId.value ?? 0)
const manage = computed(() => can('inbox.templates.manage'))
const readonly = computed(() => !manage.value || !template.value?.editable || !template.value?.supported)
const confirmingDelete = ref(false)
const tags = computed(() => template.value ? [
  statusTag({ tone: TEMPLATE_STATUS_TONE[template.value.status], label: t(`inbox.templates.status.${template.value.status}`) }),
  statusTag({ tone: TEMPLATE_CATEGORY_TONE[template.value.category], label: t(`inbox.templates.category.${template.value.category}`) }),
] : [])

function confirmDelete() {
  if (!template.value) return
  remove(template.value.id, {
    onSuccess: () => navigateTo(backTo.value, { replace: true }),
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
function onSaved() {
  toast.add({ title: t('inbox.templates.saved'), color: 'success' })
}
</script>

<template>
  <SharedRecordPage
    :title="template?.name ?? t('inbox.templates.title')"
    :tags="tags"
    :back-to="backTo"
    :back-label="t('inbox.templates.title')"
    :loading="templateId !== null && query.isPending.value"
    :error="templateId === null || channelId === null ? { status: 404 } : query.error.value"
    @retry="hydrated && query.refetch()"
  >
    <template v-if="template && channelId">
      <UAlert v-if="template.status_reason" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('inbox.templates.reason')" :description="template.status_reason" data-testid="inbox-template-reason" />
      <InboxTemplateForm :key="`${template.id}-${template.status}-${template.editable}`" :channel-id="channelId" :template="template" :readonly="readonly" side-by-side :back-to="backTo" @saved="onSaved" />
      <SharedRecordSection v-if="manage" variant="panel" :title="t('inbox.templates.dangerTitle')">
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="min-w-0 flex-1 text-sm text-muted">{{ t('inbox.templates.deleteHint') }}</p>
            <UButton type="button" color="error" variant="outline" :disabled="!hydrated || removing || confirmingDelete" :label="t('inbox.templates.delete')" data-testid="inbox-template-delete" @click="confirmingDelete = true" />
          </div>
          <SharedInlineConfirm
            v-if="confirmingDelete"
            :title="t('inbox.templates.deleteTitle', { name: template.name })"
            :description="t('inbox.templates.deleteDescription')"
            :confirm-label="t('inbox.templates.delete')"
            :pending="removing"
            @confirm="confirmDelete"
            @cancel="confirmingDelete = false"
          />
        </div>
      </SharedRecordSection>
    </template>
  </SharedRecordPage>
</template>
