<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import CustomerEraseConfirm from '@/components/customers/CustomerEraseConfirm.vue'
import CustomerErasePreview from '@/components/customers/CustomerErasePreview.vue'
import CustomerPrivacyExport from '@/components/customers/CustomerPrivacyExport.vue'
import { customerPrivacyRefusal, type CustomerPrivacyRefusal } from '@/composables/customers/customerPrivacyErrors'
import { canRunErase } from '@/composables/customers/customerPrivacyView'
import { useCustomer } from '@/composables/customers/useCustomers'
import { useCustomerErasePreview, useEraseCustomer, useExportCustomerPrivacy } from '@/composables/customers/useCustomerPrivacy'

// Privacy requests about one customer (PDPL): the export and the erase, on a page of their own under the record
// (DESIGN.md section 5: records and edits are pages, a destructive step is confirmed inline). Both are system
// administrator rights; without them the page is forbidden and sends no request.
const route = useRoute()
const sourcePaths = useRecordListPaths(['/customers'])
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const canErase = computed(() => can('customers.erase'))
const canExport = computed(() => can('customers.privacy.export'))
const allowed = computed(() => canErase.value || canExport.value)
const query = useCustomer(computed(() => allowed.value ? id.value : null))
const customer = computed(() => query.data.value)
const backTo = computed(() => recordParentTo(`/customers/${id.value}`, {
  ...route.query, listOrigin: route.query.listOrigin ?? route.query.returnTo ?? null,
}, sourcePaths.value, route.hash))

// Export
const exporter = useExportCustomerPrivacy()
const exportRefusal = ref<CustomerPrivacyRefusal | null>(null)
async function exportData(reason: string) {
  exportRefusal.value = null
  try { await exporter.mutateAsync({ id: id.value, body: { reason } }) }
  catch (failure) { exportRefusal.value = customerPrivacyRefusal(failure) }
}

// Erase: the review comes first and its token is spent by the erase.
const previewer = useCustomerErasePreview()
const eraser = useEraseCustomer()
const preview = computed(() => previewer.data.value)
const reviewFailed = ref(false)
const notice = ref<'token' | 'conflict' | null>(null)
const eraseRefusal = ref<CustomerPrivacyRefusal | null>(null)
const erasedNow = ref(false)
const erased = computed(() => erasedNow.value || preview.value?.customer.erased === true)
const mayConfirm = computed(() => !!preview.value && !erasedNow.value && canRunErase(preview.value))

async function review(reason: 'token' | 'conflict' | null = null) {
  reviewFailed.value = false
  eraseRefusal.value = null
  notice.value = reason
  try { await previewer.mutateAsync(id.value) }
  catch { reviewFailed.value = true; notice.value = null }
}
function closeReview() {
  previewer.reset()
  eraseRefusal.value = null
  notice.value = null
}
async function erase(value: { reason: string; confirmation: string }) {
  if (!preview.value) return
  eraseRefusal.value = null
  notice.value = null
  try {
    await eraser.mutateAsync({ id: id.value, body: { token: preview.value.token, ...value } })
    erasedNow.value = true
  } catch (failure) {
    const refusal = customerPrivacyRefusal(failure)
    // A spent or expired token and a changed customer both need a fresh review before anything else.
    if (refusal.kind === 'token' || refusal.kind === 'conflict') await review(refusal.kind)
    else eraseRefusal.value = refusal
  }
}
// The server's own list of what blocks the erase replaces the one the review showed.
const shownPreview = computed(() => {
  const current = preview.value
  if (!current) return undefined
  return eraseRefusal.value?.kind === 'incomplete' ? { ...current, incomplete: eraseRefusal.value.incomplete } : current
})
const eraseMessage = computed(() => {
  const kind = eraseRefusal.value?.kind
  return kind === 'forbidden' || kind === 'missing' ? t(`customers.privacy.erase.refused.${kind}`)
    : kind === 'other' ? t('customers.privacy.erase.refused.other') : null
})
const confirmable = computed(() => mayConfirm.value && eraseRefusal.value?.kind !== 'incomplete')
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('customers.privacy.title')" :back-to="backTo" />
    <SharedPageState v-if="!allowed" :empty="true" :empty-text="t('customers.privacy.forbidden')" />
    <SharedPageState v-else :loading="query.isLoading.value" :error="query.error.value" :empty="!customer" @retry="query.refetch">
      <div v-if="customer" class="space-y-6">
        <p class="text-muted">{{ t('customers.privacy.intro') }}</p>

        <CustomerPrivacyExport
          v-if="canExport"
          :pending="exporter.isPending.value"
          :failed="!!exportRefusal && exportRefusal.kind !== 'reason'"
          :reason-refused="exportRefusal?.kind === 'reason'"
          @submit="exportData"
        />

        <SharedFormSection v-if="canErase" :title="t('customers.privacy.erase.title')" :description="t('customers.privacy.erase.description')" panel>
          <div class="space-y-4" data-testid="customer-erase-section">
            <UAlert v-if="erasedNow" color="success" variant="subtle" icon="i-lucide-circle-check" role="status" :title="t('customers.privacy.erase.done.title')" :description="t('customers.privacy.erase.done.description')" data-testid="customer-erase-done" />
            <UAlert v-else-if="erased" color="neutral" variant="subtle" icon="i-lucide-shield-check" role="status" :title="t('customers.privacy.erase.erased.title')" :description="t('customers.privacy.erase.erased.description')" data-testid="customer-erase-already" />
            <template v-else>
              <UAlert v-if="notice" color="warning" variant="subtle" icon="i-lucide-refresh-cw" role="status" :title="t(`customers.privacy.erase.refused.${notice}`)" data-testid="customer-erase-notice" />
              <UAlert v-if="reviewFailed" color="error" variant="subtle" icon="i-lucide-circle-alert" role="alert" :title="t('customers.privacy.erase.reviewFailed')" />
              <UAlert v-if="eraseMessage" color="error" variant="subtle" icon="i-lucide-circle-alert" role="alert" :title="eraseMessage" data-testid="customer-erase-error" />
              <CustomerErasePreview v-if="shownPreview" :preview="shownPreview" />
              <CustomerEraseConfirm
                v-if="confirmable"
                :customer-name="customer.name"
                :pending="eraser.isPending.value"
                :name-refused="eraseRefusal?.kind === 'confirmation'"
                :reason-refused="eraseRefusal?.kind === 'reason'"
                @confirm="erase"
                @cancel="closeReview"
              />
              <SharedFormActions v-if="!confirmable">
                <UButton :icon="preview ? 'i-lucide-refresh-cw' : 'i-lucide-list-checks'" :color="preview ? 'neutral' : 'primary'" :variant="preview ? 'outline' : 'solid'" :disabled="!hydrated" :loading="previewer.isPending.value" :label="previewer.isPending.value ? t('customers.privacy.erase.reviewing') : t(preview ? 'customers.privacy.erase.reviewAgain' : 'customers.privacy.erase.review')" data-testid="customer-erase-review" @click="review()" />
              </SharedFormActions>
            </template>
          </div>
        </SharedFormSection>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>
