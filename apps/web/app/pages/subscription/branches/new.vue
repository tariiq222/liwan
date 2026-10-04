<script setup lang="ts">
import { QUOTE_IS_EXPIRED, safeIdemAction } from '@/utils/subscription'
import { safePaymentRedirect } from '@/utils/subscription'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t } = useI18n(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities(); const hydrated = useHydrated()
const allowed = computed(() => can('branches.manage'))
const { data: sub, error, pending, refresh } = await useAsyncData('subscription:branch-new', () => api.subscription(), { immediate: allowed.value })
const names = ref<string[]>(['']); const quote = ref<any>(null); const busy = ref(false); const failure = ref<unknown>(null); const placed = ref(false)
const dirty = computed(() => !placed.value && names.value.some(n => n.trim()))
const clean = computed(() => names.value.map(n => n.trim()).filter(Boolean))
const action = computed(() => safeIdemAction('branch', sub.value?.id ?? '', sub.value?.revision ?? 0, clean.value.join('|')))
watch(clean, () => { quote.value = null })
async function review() {
  if (busy.value || !clean.value.length || !sub.value) return
  busy.value = true; failure.value = null
  try { quote.value = await api.branchQuote({ subscription_id: sub.value.id, expected_subscription_revision: sub.value.revision, add: clean.value.map(name => ({ name })), archive: [] }) } catch (c) { failure.value = c } finally { busy.value = false }
}
async function accept() {
  if (busy.value || !quote.value || !sub.value) return
  if (QUOTE_IS_EXPIRED(quote.value)) { quote.value = null; return }
  busy.value = true; failure.value = null
  try {
    const { order } = await api.accept(action.value, { quote_id: quote.value.id, expected_subscription_revision: sub.value.revision })
    placed.value = true
    if (order.payment_state === 'awaiting_payment') {
      const attempt = await api.payment(order.id, action.value)
      const url = safePaymentRedirect(attempt.redirect_url, window.location.origin)
      if (url) { window.location.assign(url); return }
    }
    api.done(action.value)
    await navigateTo({ path: '/subscription/status', query: { order: order.id } })
  } catch (c) { failure.value = c; if ((c as any)?.statusCode === 409) quote.value = null } finally { busy.value = false }
}
definePageMeta({ middleware: 'customer-commercial' })
</script>
<template>
  <SharedCreatePanel :title="t('subscription.branches.newTitle')" :description="t('subscription.branches.newDescription')" back-to="/subscription/branches">
    <p v-if="!allowed" class="text-muted">{{ t('subscription.branches.readOnly') }}</p>
    <SharedPageState v-else :loading="pending" :error="error" @retry="refresh">
      <form class="space-y-4" @submit.prevent="review">
        <div v-for="(_, i) in names" :key="i" class="flex items-end gap-2">
          <UFormField :label="t('subscription.branches.name')" class="flex-1"><UInput v-model="names[i]" maxlength="200" :disabled="!hydrated" /></UFormField>
          <UButton v-if="names.length > 1" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t('subscription.branches.remove')" @click="names.splice(i, 1)" />
        </div>
        <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="!hydrated" @click="names.push('')">{{ t('subscription.branches.addName') }}</UButton>
        <UAlert v-if="failure" color="error" variant="subtle" :title="t('subscription.change.failed')" />
        <VendorPriceBreakdown :quote="quote" :pending="busy" />
        <div class="flex gap-2">
          <UButton type="submit" :disabled="!hydrated || busy || !clean.length" :loading="busy && !quote">{{ t('subscription.branches.review') }}</UButton>
          <UButton v-if="quote" type="button" :disabled="busy" :loading="busy" @click="accept">{{ t('subscription.branches.accept') }}</UButton>
        </div>
      </form>
      <SharedUnsavedChanges :dirty="dirty" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
