<script setup lang="ts">
import type { Branch, Quote } from '@liwan/commercial-contracts'
import { latestOnly, QUOTE_IS_EXPIRED, safeIdemAction, safePaymentRedirect } from '@/utils/subscription'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t } = useI18n(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities(); const hydrated = useHydrated()
const allowed = computed(() => can('subscription.read'))
const { data, error, pending, refresh } = await useAsyncData('subscription:branches', () => api.branches(), { immediate: allowed.value })
definePageMeta({ middleware: 'customer-commercial' })

// Archiving stops work in a branch (its records stay readable and in reports); restoring brings it back as a priced
// order. The price is quoted when the confirmation opens and shown inside it, so the customer sees the cost first.
type BranchChange = { kind: 'archive' | 'restore'; branch: Branch }
const archiving = ref<BranchChange | null>(null); const quote = ref<Quote | null>(null); const quoteRevision = ref(0); const quoteSubscription = ref('')
const archiveBusy = ref(false); const archiveFailed = ref<string | null>(null)
const archiveAction = computed(() => safeIdemAction(`branch-${archiving.value?.kind ?? 'archive'}`, quoteSubscription.value, quoteRevision.value, archiving.value?.branch.id ?? ''))
// A refused restore says why (name taken, extra-branch limit); anything else is the generic failure.
const REFUSALS = ['branch_name_taken', 'branch_limit_exceeded', 'branch_not_archived']
function failureKey(cause: unknown): string {
  const e = cause as { data?: { code?: unknown; data?: { code?: unknown } } } | null
  const code = e?.data?.code ?? e?.data?.data?.code
  return typeof code === 'string' && REFUSALS.includes(code) ? code : 'failed'
}
// Quotes are asked one after another as the customer picks branches: only the newest answer may fill the confirmation,
// or a late quote for branch A would sit under a confirmation that names branch B.
const quoteTickets = latestOnly()
async function openChange(kind: BranchChange['kind'], branch: Branch) {
  const ticket = quoteTickets.next()
  archiving.value = { kind, branch }; quote.value = null; archiveFailed.value = null; archiveBusy.value = true
  try {
    const sub = await api.subscription()
    if (!quoteTickets.isCurrent(ticket)) return
    const answer = await api.branchQuote({ subscription_id: sub.id, expected_subscription_revision: sub.revision, add: [], archive: kind === 'archive' ? [branch.id] : [], restore: kind === 'restore' ? [branch.id] : [] })
    if (!quoteTickets.isCurrent(ticket)) return
    quoteSubscription.value = sub.id; quoteRevision.value = sub.revision; quote.value = answer
  } catch (cause) { if (quoteTickets.isCurrent(ticket)) archiveFailed.value = failureKey(cause) } finally { if (quoteTickets.isCurrent(ticket)) archiveBusy.value = false }
}
function closeArchive() { quoteTickets.cancel(); archiveBusy.value = false; archiving.value = null; quote.value = null; archiveFailed.value = null }
async function archiveBranch() {
  if (archiveBusy.value || !archiving.value || !quote.value) return
  if (QUOTE_IS_EXPIRED(quote.value)) { await openChange(archiving.value.kind, archiving.value.branch); return }
  archiveBusy.value = true; archiveFailed.value = null
  try {
    const { order } = await api.accept(archiveAction.value, { quote_id: quote.value.id, expected_subscription_revision: quoteRevision.value })
    if (order.payment_state === 'awaiting_payment') {
      const attempt = await api.payment(order.id, archiveAction.value)
      const url = safePaymentRedirect(attempt.redirect_url, window.location.origin)
      if (url) { window.location.assign(url); return }
    }
    api.done(archiveAction.value)
    await navigateTo({ path: '/subscription/status', query: { order: order.id } })
  } catch (cause) { archiveFailed.value = failureKey(cause); if ((cause as { statusCode?: number })?.statusCode === 409) quote.value = null } finally { archiveBusy.value = false }
}
</script>
<template>
  <SharedSettingsPage width="list">
    <SharedPageHeader :title="t('subscription.branches.title')" back-to="/subscription">
      <template #actions><UButton v-if="can('branches.manage')" to="/subscription/branches/new" icon="i-lucide-plus" :disabled="!hydrated">{{ t('subscription.branches.add') }}</UButton></template>
    </SharedPageHeader>
    <SharedForbiddenState v-if="!allowed" />
    <template v-else>
      <p v-if="!can('branches.manage')" class="text-sm text-muted">{{ t('subscription.branches.readOnly') }}</p>
      <SharedPageState :loading="pending" :error="error" @retry="refresh"><SharedRecordSection v-if="data" variant="list"><SubscriptionBranchSummary :summary="data" :archivable="can('branches.manage') && hydrated && !archiveBusy" @archive="openChange('archive', $event)" @restore="openChange('restore', $event)" /></SharedRecordSection></SharedPageState>
      <SharedInlineConfirm v-if="archiving" :title="t(`subscription.branches.${archiving.kind}.title`, { name: archiving.branch.name })" :description="t(`subscription.branches.${archiving.kind}.description`)" :confirm-label="t(`subscription.branches.${archiving.kind}.action`)" :color="archiving.kind === 'archive' ? 'error' : 'primary'" :pending="archiveBusy" :disabled="!quote" @confirm="archiveBranch" @cancel="closeArchive">
        <SharedCommercePriceBreakdown :quote="quote" :pending="archiveBusy" class="mt-3" />
        <div v-if="archiveFailed" class="mt-3 flex flex-wrap items-center gap-2">
          <p class="text-sm" role="alert">{{ t(`subscription.branches.refusals.${archiveFailed}`) }}</p>
          <UButton type="button" color="neutral" variant="outline" size="sm" :disabled="archiveBusy" @click="openChange(archiving.kind, archiving.branch)">{{ t('subscription.branches.archive.retry') }}</UButton>
        </div>
      </SharedInlineConfirm>
    </template>
    <NuxtPage />
  </SharedSettingsPage>
</template>
