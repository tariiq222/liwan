<script setup lang="ts">
import { statusTag } from '@liwan/ui/app/utils/pageHeaderTag'
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { saveErrorMessage } from '@/utils/formFeedback'
import SalesTemplateLines from '@/components/sales/SalesTemplateLines.vue'
import { salesRefusalKey } from '@/composables/sales/salesErrors'
import { SALES_TEMPLATES_PATH } from '@/composables/sales/salesTemplateParams'
import { useMoveSalesTemplate } from '@/composables/sales/useSalesTemplates'
import { useSalesTemplateRecord } from '@/composables/sales/useSalesTemplateRecord'

// A quotation template. Editing, archiving and restoring are for the settings manager; an archived template leaves the
// pick list of a new quotation and is edited only after it is restored.
const route = useRoute()
const router = useRouter()
const sourcePaths = useRecordListPaths([SALES_TEMPLATES_PATH])
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
useSettingsPage('sales')
const { query, template, loading, error, canManage } = useSalesTemplateRecord()
const backTo = computed(() => router.resolve(owningListBack(route.query, sourcePaths.value, route.hash)).fullPath)
const tags = computed(() => {
  if (!template.value) return []
  if (template.value.archived) return [statusTag({ tone: 'neutral', label: t('sales.templates.archived') })]
  return [statusTag(template.value.usable ? { tone: 'success', label: t('sales.templates.ready') } : { tone: 'warning', label: t('sales.templates.needsAttention') })]
})

const { mutateAsync: move, isPending: moving } = useMoveSalesTemplate()
const busy = computed(() => !hydrated.value || moving.value)
const confirming = ref(false)
const actionError = ref<unknown>(null)
const actionMessage = computed(() => {
  const key = salesRefusalKey(actionError.value)
  return key ? t(key) : saveErrorMessage(actionError.value, t('errors.generic'), t('errors.saveUncertain'))
})
async function run(action: 'archive' | 'restore') {
  if (busy.value || !template.value) return
  actionError.value = null
  try {
    await move({ id: template.value.id, action })
    confirming.value = false
  } catch (error) {
    actionError.value = error
  }
}
</script>

<template>
  <SharedRecordPage
    :keep-content="!!template"
    :title="template?.name ?? t('sales.templates.recordTitle')"
    :tags="tags"
    :back-to="backTo"
    :back-label="t('sales.templates.title')"
    :loading="loading"
    :error="error"
    @retry="query.refetch"
  >
    <template v-if="template && canManage" #actions>
      <UButton v-if="!template.archived" color="primary" icon="i-lucide-pencil" :disabled="busy" :to="recordChildTo(`${SALES_TEMPLATES_PATH}/${template.id}/edit`, route.query, sourcePaths, route.hash)" :label="t('app.edit')" data-testid="sales-template-edit" />
      <UButton v-if="!template.archived" color="error" variant="outline" icon="i-lucide-archive" :disabled="busy" :label="t('sales.templates.archive')" data-testid="sales-template-archive" @click="confirming = !confirming" />
      <UButton v-else color="neutral" variant="outline" icon="i-lucide-archive-restore" :loading="moving" :disabled="busy" :label="t('sales.templates.restore')" data-testid="sales-template-restore" @click="run('restore')" />
    </template>
    <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="t('sales.templates.actionError')" :description="actionMessage" data-testid="sales-template-action-error" />
    <UAlert v-if="template && !template.archived && !template.usable" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('sales.templates.unusableTitle')" :description="t('sales.templates.unusable')" data-testid="sales-template-unusable-note" />
    <SharedInlineConfirm
      v-if="template && confirming"
      color="error"
      :title="t('sales.templates.archiveConfirm', { name: template.name })"
      :description="t('sales.templates.archiveHint')"
      :confirm-label="t('sales.templates.archive')"
      :cancel-label="t('sales.record.confirmKeep')"
      :pending="moving"
      :disabled="busy"
      @confirm="run('archive')"
      @cancel="confirming = false"
    />
    <SharedRecordSection v-if="template" variant="panel" :title="t('sales.templates.form.lines')">
      <SalesTemplateLines :lines="template.lines" />
    </SharedRecordSection>
    <template v-if="template" #aside>
      <SharedPropertiesPanel :title="t('sales.record.details')">
        <SharedPropertyRow :label="t('sales.templates.form.validityDays')" data-testid="sales-template-validity">
          <template v-if="template.validity_days">{{ t('sales.templates.days', { count: template.validity_days }, template.validity_days) }}</template>
          <template v-else>{{ t('sales.templates.settingsValidity') }}</template>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('sales.templates.columns.lines')" :value="t('sales.templates.lineCount', { count: template.line_count }, template.line_count)" />
      </SharedPropertiesPanel>
      <SharedPropertiesPanel :title="t('sales.form.terms')">
        <p class="whitespace-pre-line text-sm text-default" data-testid="sales-template-terms">{{ template.terms || t('sales.record.noTerms') }}</p>
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
