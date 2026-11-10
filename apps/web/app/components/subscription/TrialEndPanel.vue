<script setup lang="ts">
import type { TrialEndPreview } from '@liwan/commercial-contracts'
import { quoteLinesByTiming } from '@liwan/commercial-ui/app/utils/commercial'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { formatSubscriptionMoney } from '../../utils/subscription'

const props = defineProps<{
  preview: TrialEndPreview
  bundleNames: Record<string, string>
  canManageTeam?: boolean
  canOpenDocuments?: boolean
  canOpenStorage?: boolean
  canReadBranches?: boolean
  canReadBilling?: boolean
}>()

const { t, locale } = useI18n()
const ended = computed(() => props.preview.status === 'settled')
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const quantity = (value: number | null) => value === null ? t('subscription.usage.unavailable') : number.format(value)
const storage = (bytes: number | null) => bytes === null
  ? t('subscription.usage.unavailable')
  : t('subscription.trialEnd.mib', { value: number.format(bytes / (1024 ** 2)) })
const bundleGroup = (ids: string[]) => ({
  names: ids.map(id => props.bundleNames[id]).filter((name): name is string => Boolean(name)),
  unnamed: ids.filter(id => !props.bundleNames[id]).length,
})
const kept = computed(() => bundleGroup(props.preview.kept.bundle_revision_ids))
const locked = computed(() => bundleGroup(props.preview.locked_bundle_revision_ids))
const paidExtras = computed(() => props.preview.kept.paid_users || props.preview.kept.paid_storage_gb || props.preview.kept.paid_extra_branches)
const lines = computed(() => props.preview.first_invoice
  ? quoteLinesByTiming(props.preview.first_invoice, 'now').map(line => ({
      id: line.key,
      description: line.kind === 'users' ? t('subscription.change.users')
        : line.kind === 'storage' ? t('subscription.change.storage') : line.description,
      cells: [],
      amount: formatSubscriptionMoney(line.amount, locale.value),
    }))
  : [])
const resourceLinks = computed(() => [
  ...(props.canManageTeam ? [{ value: 'team', label: t('subscription.trialEnd.team'), to: '/settings/team/users' }] : []),
  ...(props.canReadBranches ? [{ value: 'branches', label: t('subscription.branches.title'), to: '/subscription/branches' }] : []),
  { value: 'usage', label: t('subscription.usage.title'), to: '/subscription#storage-usage' },
  ...(props.canOpenStorage ? [{ value: 'storage', label: t('settings.storage.open'), to: '/settings/system/storage?blocked=true' }] : []),
  ...(props.canOpenDocuments ? [{ value: 'documents', label: t('subscription.trialEnd.documents'), to: '/documents' }] : []),
])
const totals = computed(() => props.preview.first_invoice ? [{
  label: t('subscription.trialEnd.firstInvoiceTotal'),
  value: formatSubscriptionMoney(props.preview.first_invoice.due_now, locale.value),
}] : [])
</script>

<template>
  <SharedRecordSection id="trial-end" variant="panel" :title="t('subscription.trialEnd.title')" data-testid="trial-end-panel">
    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>
    <div class="grid gap-(--liwan-gap-card)">
      <UAlert
        data-testid="trial-end-status"
        role="status"
        :color="preview.status === 'trial_ending' || preview.status === 'lock_pending' ? 'warning' : 'info'"
        variant="subtle"
        :title="t(`subscription.trialEnd.states.${preview.status}`)"
        :description="t(`subscription.trialEnd.details.${preview.status}`)"
      />
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('subscription.trialEnd.cutoff')" :value="formatDateTime(preview.trial_ends_at, 'Asia/Riyadh')" />
        <SharedPropertyRow v-if="preview.next_attempt_at" :label="t('subscription.trialEnd.nextAttempt')" :value="formatDateTime(preview.next_attempt_at, 'Asia/Riyadh')" />
        <SharedPropertyRow v-if="preview.outcome" :label="t('subscription.trialEnd.outcome')" :value="t(`subscription.trialEnd.outcomes.${preview.outcome}`)" />
      </SharedPropertiesPanel>

      <div class="grid gap-(--liwan-gap-card) sm:grid-cols-2">
        <div v-for="group in [{ key: 'kept', ...kept }, { key: 'locked', ...locked }]" :key="group.key">
          <h3 class="mb-2 text-sm font-semibold">{{ t(`subscription.trialEnd.bundles.${group.key}`) }}</h3>
          <ul v-if="group.names.length" class="flex flex-wrap gap-2">
            <li v-for="(name, index) in group.names" :key="index">
              <SharedStatusBadge :label="name" tone="neutral" variant="subtle" />
            </li>
          </ul>
          <p v-if="group.unnamed" class="mt-2 text-sm text-muted">
            {{ t('subscription.trialEnd.unnamedBundles', { count: group.unnamed }) }}
          </p>
          <p v-else-if="!group.names.length" class="text-sm text-muted">{{ t('subscription.trialEnd.noBundles') }}</p>
        </div>
      </div>

      <div>
        <h3 class="mb-2 text-sm font-semibold">{{ t('subscription.trialEnd.capacity') }}</h3>
        <SharedPropertiesPanel>
          <SharedPropertyRow :label="t('subscription.change.users')" :value="quantity(preview.limits.users)" />
          <SharedPropertyRow :label="t('subscription.change.storage')" :value="t('subscription.trialEnd.mib', { value: quantity(preview.limits.storage_mb) })" />
          <SharedPropertyRow :label="t('subscription.usage.extra_branches')" :value="quantity(preview.limits.extra_branches)" />
        </SharedPropertiesPanel>
      </div>

      <div v-if="paidExtras">
        <h3 class="mb-2 text-sm font-semibold">{{ t('subscription.trialEnd.paidCapacity') }}</h3>
        <SharedPropertiesPanel>
          <SharedPropertyRow :label="t('subscription.change.users')" :value="quantity(preview.kept.paid_users)" />
          <SharedPropertyRow :label="t('subscription.trialEnd.paidStorage')" :value="quantity(preview.kept.paid_storage_gb)" />
          <SharedPropertyRow :label="t('subscription.usage.extra_branches')" :value="quantity(preview.kept.paid_extra_branches)" />
        </SharedPropertiesPanel>
      </div>

      <div>
        <h3 class="mb-2 text-sm font-semibold">{{ t('subscription.trialEnd.excess') }}</h3>
        <SharedPropertiesPanel>
          <SharedPropertyRow :label="t('subscription.trialEnd.excessUsers')" :value="quantity(preview.excess.users)" />
          <SharedPropertyRow :label="t('subscription.trialEnd.excessBranches')" :value="quantity(preview.excess.extra_branches)" />
          <SharedPropertyRow :label="t('subscription.trialEnd.excessStorage')" :value="storage(preview.excess.storage_bytes)" />
        </SharedPropertiesPanel>
        <p v-if="preview.excess.source === 'unavailable'" class="mt-2 text-sm text-muted">{{ t('subscription.trialEnd.usageUnavailable') }}</p>
        <p v-else-if="preview.excess.sampled_at" class="mt-2 text-sm text-muted">{{ t('subscription.trialEnd.sampledAt', { date: formatDateTime(preview.excess.sampled_at, 'Asia/Riyadh') }) }}</p>
        <p class="mt-2 text-sm text-muted">{{ t('subscription.trialEnd.itemDetailsUnavailable') }}</p>
        <p v-if="!ended" class="mt-2 text-sm text-muted">{{ t('subscription.trialEnd.exportAdvice') }}</p>
        <SharedSegmentedControl class="mt-2 flex-wrap" mode="actions" :label="t('subscription.trialEnd.resourceLinks')" :items="resourceLinks" />
      </div>

      <div>
        <h3 class="mb-2 text-sm font-semibold">{{ t(ended ? 'subscription.trialEnd.firstInvoice' : 'subscription.trialEnd.firstInvoiceEstimate') }}</h3>
        <SharedInvoiceLines v-if="preview.first_invoice" layout="list" :lines="lines" :totals="totals" />
        <p v-else class="text-sm text-muted">{{ t('subscription.trialEnd.noInvoiceShown') }}</p>
        <UButton v-if="canReadBilling && ended" to="/subscription/invoices" class="mt-2" size="sm" color="neutral" variant="link">{{ t('subscription.invoices.all') }}</UButton>
      </div>
    </div>
  </SharedRecordSection>
</template>
