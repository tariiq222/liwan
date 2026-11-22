<script setup lang="ts">
import type { RefundRecheck, ReturnedRefundResolution } from '@liwan/commercial-contracts'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { adjustmentStatusBadge } from '@/utils/vendorBadges'
import { recordResolutions } from '@/utils/stuckRefund'
import { refundErrorKey, validRefundReason, type VendorAdjustment } from '@/utils/vendorSubscriptions'
import { formatBusinessDateTime } from '@/utils/vendorTime'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
// One pending credit note whose automatic refund is stuck (`note.automatic_refund.stuck` is set): what it waits for and the three actions the server allows.
// None of them refunds money; the control plane's refund worker is the only path that does. The page shows this only to an account that manages billing.
// The page owns which form is open (one draft at a time on the invoice page): `form` is the open one, `open`/`close` ask the page, `draft` says whether it holds typed text.
const props = defineProps<{ note: VendorAdjustment; form: 'release' | 'record' | null }>()
const emit = defineEmits<{ changed: []; open: [action: 'release' | 'record']; close: []; draft: [typed: boolean] }>()
const { t, locale } = useI18n(); const hydrated = useHydrated(); const api = useVendorSubscriptions()
const stuck = computed(() => props.note.automatic_refund?.stuck ?? null)
const conflict = computed(() => stuck.value?.conflict ?? null)
const allows = (action: 'check' | 'release' | 'record') => Boolean(stuck.value?.actions.includes(action))
const action = computed(() => props.form)
const reason = ref('')
const resolution = ref<ReturnedRefundResolution>('record')
const busy = ref(false)
const failure = ref<string | undefined>()
const checked = ref<RefundRecheck | null>(null)
const resolutions = computed(() => recordResolutions(props.note, conflict.value))
const resolutionItems = computed(() => resolutions.value.map(value => ({ label: t(`vendor.invoices.refund.stuck.record.resolutions.${value}`), value })))
const valid = computed(() => validRefundReason(reason.value))
const dirty = computed(() => Boolean(action.value && reason.value.trim()))
watch(dirty, typed => emit('draft', typed))
// Another form on the page took over, or this one closed: the typed text and the last refusal go with it.
watch(action, () => { reason.value = ''; resolution.value = 'record'; failure.value = undefined })
const money = (m: NonNullable<RefundRecheck['refunded']>) => formatCommercialMoney(m, locale.value)
const time = (value: string) => formatBusinessDateTime(value)
const open = (next: 'release' | 'record') => emit('open', next)
const close = () => emit('close')
/** Runs one call, then tells the page to reload: the server's state decides what is offered next, after a refusal too. */
async function run(call: () => Promise<{ provider: RefundRecheck | null }>, onDone: (provider: RefundRecheck | null) => void) {
  if (!hydrated.value || busy.value) return
  busy.value = true; failure.value = undefined
  try { onDone((await call()).provider) } catch (cause) { failure.value = t(refundErrorKey(cause)) } finally { busy.value = false; emit('changed') }
}
const check = () => run(() => api.checkStuckRefund(props.note.id), provider => { checked.value = provider })
function submit() {
  if (!action.value || !valid.value) return
  const reasonText = reason.value
  return action.value === 'release'
    ? run(() => api.releaseRefundHold(props.note.id, { reason: reasonText }), () => close())
    : run(() => api.recordReturnedRefund(props.note.id, { reason: reasonText, resolution: resolution.value }), () => close())
}
</script>
<template>
  <div v-if="stuck" class="space-y-3 rounded-md border border-default p-3" data-testid="stuck-refund">
    <p class="text-sm font-medium">{{ t('vendor.invoices.refund.stuck.title') }}</p>
    <p class="text-sm text-muted">{{ t('vendor.invoices.refund.stuck.hint') }}</p>
    <dl class="grid gap-2 text-sm sm:grid-cols-5" data-testid="stuck-refund-facts">
      <div><dt class="text-muted">{{ t('vendor.invoices.refund.stuck.since') }}</dt><dd>{{ time(stuck.since) }}</dd></div>
      <div><dt class="text-muted">{{ t('vendor.invoices.refund.stuck.attempts') }}</dt><dd>{{ stuck.attempts }}</dd></div>
      <div><dt class="text-muted">{{ t('vendor.invoices.refund.stuck.nextAttempt') }}</dt><dd>{{ time(stuck.next_attempt_at) }}</dd></div>
      <div v-if="stuck.release_from"><dt class="text-muted">{{ t('vendor.invoices.refund.stuck.releaseFrom') }}</dt><dd>{{ time(stuck.release_from) }}</dd></div>
      <div><dt class="text-muted">{{ t('vendor.invoices.refund.stuck.paymentId') }}</dt><dd><bdi v-if="stuck.provider_payment_id" dir="ltr" class="select-all font-mono">{{ stuck.provider_payment_id }}</bdi><span v-else>{{ t('vendor.invoices.refund.stuck.noPaymentId') }}</span></dd></div>
    </dl>

    <div v-if="conflict" class="space-y-2 rounded-md border border-warning p-3" role="group" :aria-label="t('vendor.invoices.refund.stuck.conflict.title')" data-testid="stuck-refund-conflict">
      <p class="flex items-center gap-2 text-sm font-medium"><UIcon name="i-lucide-triangle-alert" class="size-4 text-warning" />{{ t('vendor.invoices.refund.stuck.conflict.title') }}</p>
      <p class="text-sm text-muted">{{ t('vendor.invoices.refund.stuck.conflict.hint') }}</p>
      <dl class="grid gap-2 text-sm sm:grid-cols-3">
        <div><dt class="text-muted">{{ t('vendor.invoices.refund.stuck.conflict.invoice') }}</dt>
          <dd><NuxtLink v-if="!conflict.same_invoice" :to="{ path: `/invoices/${encodeURIComponent(conflict.invoice_id)}` }" class="hover:underline" data-testid="stuck-refund-conflict-link"><bdi dir="ltr">{{ conflict.invoice_number ?? t('vendor.invoices.draftNumber') }}</bdi> · {{ t('vendor.invoices.refund.stuck.conflict.openInvoice') }}</NuxtLink>
            <template v-else><bdi dir="ltr">{{ conflict.invoice_number ?? t('vendor.invoices.draftNumber') }}</bdi> · {{ t('vendor.invoices.refund.stuck.conflict.sameInvoice') }}</template></dd></div>
        <div><dt class="text-muted">{{ t('vendor.invoices.refund.stuck.conflict.amount') }}</dt><dd class="tabular-nums">{{ money(conflict.amount) }}</dd></div>
        <div><dt class="text-muted">{{ t('vendor.invoices.refund.stuck.conflict.cause') }}</dt><dd>{{ t(`vendor.invoices.refund.stuck.conflict.causes.${conflict.cause}`) }}</dd></div>
        <div><dt class="text-muted">{{ t('vendor.invoices.refund.stuck.conflict.status') }}</dt><dd>{{ t(adjustmentStatusBadge(conflict.status).labelKey) }}</dd></div>
        <div><dt class="text-muted">{{ t('vendor.invoices.refund.stuck.conflict.by') }}</dt><dd><bdi dir="ltr">{{ conflict.refunded_by ?? '' }}</bdi></dd></div>
        <div><dt class="text-muted">{{ t('vendor.invoices.refund.stuck.conflict.at') }}</dt><dd>{{ conflict.refunded_at ? time(conflict.refunded_at) : '' }}</dd></div>
      </dl>
    </div>

    <div v-if="checked" class="space-y-2 rounded-md border border-info p-3" role="status" data-testid="stuck-refund-check-result">
      <p class="text-sm font-medium">{{ t('vendor.invoices.refund.stuck.check.resultTitle') }}</p>
      <dl class="grid gap-2 text-sm sm:grid-cols-3">
        <div><dt class="text-muted">{{ t('vendor.invoices.refund.stuck.check.statusLabel') }}</dt><dd>{{ t(`vendor.invoices.refund.stuck.check.status.${checked.status}`) }}</dd></div>
        <div><dt class="text-muted">{{ t('vendor.invoices.refund.stuck.check.refunded') }}</dt><dd class="tabular-nums">{{ checked.refunded ? money(checked.refunded) : t('vendor.invoices.refund.stuck.check.none') }}</dd></div>
        <div><dt class="text-muted">{{ t('vendor.invoices.refund.stuck.check.paymentId') }}</dt><dd><bdi dir="ltr" class="select-all font-mono">{{ checked.payment_id ?? '' }}</bdi></dd></div>
      </dl>
      <p class="text-sm text-muted">{{ t('vendor.invoices.refund.stuck.check.outcome') }}</p>
    </div>

    <SharedInlineConfirm v-if="action" :title="t(`vendor.invoices.refund.stuck.${action}.confirmTitle`)" :description="t(`vendor.invoices.refund.stuck.${action}.confirmHint`)"
      :confirm-label="t(`vendor.invoices.refund.stuck.${action}.confirm`)" :pending="busy" :disabled="!hydrated || busy || !valid" @confirm="submit" @cancel="close">
      <div class="mt-3 space-y-4">
        <UFormField v-if="action === 'record' && resolutions.length > 1" :label="t('vendor.invoices.refund.stuck.record.resolution')" required>
          <USelect v-model="resolution" :items="resolutionItems" :disabled="!hydrated || busy" class="w-full" data-testid="stuck-refund-resolution" />
        </UFormField>
        <p v-else-if="action === 'record'" class="text-sm text-muted" data-testid="stuck-refund-resolution-only">{{ t('vendor.invoices.refund.stuck.record.resolutions.record') }}</p>
        <UFormField :label="t(`vendor.invoices.refund.stuck.${action}.reason`)" required><UTextarea v-model="reason" :maxlength="1000" :disabled="!hydrated || busy" class="w-full" data-testid="stuck-refund-reason" /></UFormField>
      </div>
    </SharedInlineConfirm>
    <div v-else class="flex flex-wrap items-center gap-2">
      <UButton v-if="allows('check')" color="neutral" variant="outline" size="sm" icon="i-lucide-refresh-cw" :loading="busy" :disabled="!hydrated || busy" data-testid="stuck-refund-check" @click="check">{{ t('vendor.invoices.refund.stuck.check.action') }}</UButton>
      <UButton v-if="allows('release')" color="warning" variant="soft" size="sm" :disabled="!hydrated || busy" data-testid="stuck-refund-release" @click="open('release')">{{ t('vendor.invoices.refund.stuck.release.action') }}</UButton>
      <UButton v-if="allows('record')" color="primary" variant="soft" size="sm" :disabled="!hydrated || busy" data-testid="stuck-refund-record" @click="open('record')">{{ t('vendor.invoices.refund.stuck.record.action') }}</UButton>
    </div>
    <UAlert v-if="failure" color="error" variant="subtle" :title="failure" data-testid="stuck-refund-failure" />
  </div>
</template>
