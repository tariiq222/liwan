<script setup lang="ts">
import { actionBlockedReason, availableActions, commercialErrorKey, commercialFailure, lifecycleStatus, type BundleView, type CommercialKind, type LifecycleAction, type PlanView } from '@/utils/vendorCommercial'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
const props = defineProps<{ kind: CommercialKind; view: BundleView | PlanView }>()
const emit = defineEmits<{ done: [action: LifecycleAction, result: BundleView | PlanView | null]; reload: [] }>()
const { t } = useI18n(); const hydrated = useHydrated(); const { can } = useVendorContext(); const api = useVendorCommercial()
const action = ref<LifecycleAction | null>(null); const reason = ref(''); const attempted = ref(false); const busy = ref(false); const failure = ref<unknown>(null)
const status = computed(() => lifecycleStatus(props.view))
const actions = computed(() => availableActions(status.value))
const parsed = computed(() => (failure.value ? commercialFailure(failure.value) : null))
const reasonError = computed(() => (attempted.value && (reason.value.trim().length < 3 || reason.value.trim().length > 1000) ? t('vendor.pricing.reasonRequired') : undefined))
const blocked = (a: LifecycleAction) => actionBlockedReason(props.kind, a, can as never)
const issues = computed(() => props.view.issues ?? [])
const dirty = computed(() => Boolean(action.value && reason.value.trim()))
function choose(a: LifecycleAction) { action.value = a; reason.value = ''; attempted.value = false; failure.value = null }
function cancel() { action.value = null; reason.value = ''; attempted.value = false }
async function perform() {
  const a = action.value
  if (!hydrated.value || !a || busy.value || blocked(a)) return
  attempted.value = true
  if (reasonError.value) return
  busy.value = true; failure.value = null
  try {
    const result = await api.act<BundleView | PlanView>(props.kind, props.view.id, a, props.view.edit_revision, reason.value)
    cancel(); emit('done', a, a === 'delete' ? null : result)
  } catch (cause) { failure.value = cause } finally { busy.value = false }
}
const destructive = (a: LifecycleAction) => a === 'delete' || a === 'withdraw'
</script>
<template>
  <SharedFormSection :title="t('vendor.pricing.lifecycle.title')" :description="t('vendor.pricing.lifecycle.preserve')" data-testid="lifecycle-panel">
    <SharedUnsavedChanges :dirty="dirty" guard-route-updates />
    <UAlert v-if="parsed?.conflict" color="warning" variant="subtle" :title="t('vendor.pricing.errors.revision_conflict')"><template #actions><UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated" @click="emit('reload')">{{ t('vendor.pricing.reload') }}</UButton></template></UAlert>
    <UAlert v-else-if="failure" color="error" variant="subtle" :title="t(commercialErrorKey(failure))" :description="parsed?.field ? t('vendor.pricing.errors.atField', { field: parsed.field }) : undefined" />
    <ul v-if="issues.length" class="space-y-1 text-sm text-warning" data-testid="issues"><li v-for="issue in issues" :key="`${issue.code}-${issue.field}`">{{ t(commercialErrorKey({ code: issue.code })) }}<bdi v-if="issue.field" class="ms-2 text-muted" dir="ltr">{{ issue.field }}</bdi></li></ul>
    <div v-if="!action" class="flex flex-wrap gap-2">
      <template v-for="a in actions" :key="a">
        <UButton :color="destructive(a) ? 'error' : 'neutral'" :variant="destructive(a) ? 'ghost' : 'outline'" :disabled="!hydrated || busy || Boolean(blocked(a))" :data-action="a" @click="choose(a)">{{ t(`vendor.pricing.actions.${a}`) }}</UButton>
        <p v-if="blocked(a)" class="self-center text-sm text-muted" :data-reason-for="a">{{ t(`vendor.pricing.blocked.${blocked(a)}`) }}</p>
      </template>
    </div>
    <template v-else>
      <SharedInlineConfirm v-if="destructive(action)" :title="t(`vendor.pricing.actions.${action}`)" :description="t(`vendor.pricing.effects.${action}`)" :confirm-label="t(`vendor.pricing.actions.${action}`)" :pending="busy" @cancel="cancel" @confirm="perform">
        <UFormField :label="t('vendor.pricing.fields.reason')" required :error="reasonError" class="mt-3"><UTextarea v-model="reason" maxlength="1000" class="w-full" :disabled="busy" /></UFormField>
      </SharedInlineConfirm>
      <form v-else class="space-y-4" novalidate @submit.prevent="perform">
        <UAlert color="neutral" variant="subtle" :title="t(`vendor.pricing.actions.${action}`)" :description="t(`vendor.pricing.effects.${action}`)" />
        <UFormField :label="t('vendor.pricing.fields.reason')" required :error="reasonError"><UTextarea v-model="reason" maxlength="1000" class="w-full" :disabled="busy" /></UFormField>
        <div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" :disabled="busy" @click="cancel">{{ t('app.cancel') }}</UButton><UButton type="submit" :loading="busy" :disabled="!hydrated || busy">{{ t(`vendor.pricing.actions.${action}`) }}</UButton></div>
      </form>
    </template>
  </SharedFormSection>
</template>
