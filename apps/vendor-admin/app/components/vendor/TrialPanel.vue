<script setup lang="ts">
import { daysBetween, riyadhDate, type SubscriptionView } from '@liwan/commercial-contracts'
import { commercialErrorKey } from '@/utils/vendorCommercial'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
const props = defineProps<{ subscription: SubscriptionView }>()
const emit = defineEmits<{ done: [] }>()
const { t } = useI18n(); const { can } = useVendorContext(); const api = useVendorSubscriptions(); const hydrated = useHydrated()
const action = ref<'extend' | 'end' | null>(null); const days = ref('7'); const reason = ref('')
const busy = ref(false); const failure = ref<string | undefined>()
const daysLeft = computed(() => props.subscription.trial_ends_at ? daysBetween(riyadhDate(new Date()), riyadhDate(new Date(props.subscription.trial_ends_at))) : null)
const dayCount = computed(() => { const n = Number(days.value.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))); return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null })
const valid = computed(() => reason.value.trim().length >= 3 && (action.value !== 'extend' || dayCount.value !== null))
const blocked = computed(() => !hydrated.value || busy.value || !can('vendor.subscriptions.manage'))
function choose(next: 'extend' | 'end') { action.value = next; reason.value = ''; failure.value = undefined }
async function perform() {
  if (!action.value || blocked.value || !valid.value) return
  busy.value = true; failure.value = undefined
  try {
    if (action.value === 'extend') await api.extendTrial(props.subscription.id, { days: dayCount.value!, reason: reason.value.trim() })
    else await api.endTrial(props.subscription.id, { reason: reason.value.trim() })
    action.value = null; reason.value = ''; emit('done')
  } catch (cause) { failure.value = t(commercialErrorKey(cause)) } finally { busy.value = false }
}
</script>
<template>
  <SharedRecordSection variant="panel" :title="t('vendor.customers.trial.title')">
    <dl class="grid gap-2 text-sm sm:grid-cols-3">
      <div><dt class="text-muted">{{ t('vendor.customers.trial.ends') }}</dt><dd><bdi dir="ltr">{{ subscription.trial_ends_at?.slice(0, 10) ?? '—' }}</bdi></dd></div>
      <div><dt class="text-muted">{{ t('vendor.customers.trial.remaining') }}</dt><dd class="tabular-nums">{{ daysLeft ?? '—' }}</dd></div>
      <div><dt class="text-muted">{{ t('vendor.customers.trial.state') }}</dt><dd>{{ t(`vendor.customers.trial.states.${subscription.state}`) }}</dd></div>
    </dl>
    <UAlert v-if="failure" class="mt-3" color="error" variant="subtle" :title="failure" />
    <template v-if="!action">
      <div class="mt-4 flex flex-wrap gap-2">
        <UButton color="neutral" variant="outline" :disabled="blocked" @click="choose('extend')">{{ t('vendor.customers.trial.extend') }}</UButton>
        <UButton color="error" variant="outline" :disabled="blocked" @click="choose('end')">{{ t('vendor.customers.trial.end') }}</UButton>
      </div>
      <p v-if="!can('vendor.subscriptions.manage')" class="mt-2 text-sm text-muted">{{ t('vendor.customers.trial.readOnly') }}</p>
    </template>
    <SharedInlineConfirm v-else :title="t(`vendor.customers.trial.${action}`)" :description="t(`vendor.customers.trial.${action}Hint`)" :confirm-label="t(`vendor.customers.trial.${action}`)" :pending="busy" :disabled="blocked || !valid" @confirm="perform" @cancel="action = null; reason = ''; failure = undefined">
      <div class="mt-3 space-y-4">
        <UFormField v-if="action === 'extend'" :label="t('vendor.customers.trial.days')" required><UInput v-model="days" inputmode="numeric" dir="ltr" class="w-full sm:w-40" :disabled="blocked" /></UFormField>
        <UFormField :label="t('vendor.customers.trial.reason')" required><UTextarea v-model="reason" :maxlength="1000" class="w-full" :disabled="blocked" /></UFormField>
      </div>
    </SharedInlineConfirm>
  </SharedRecordSection>
</template>
