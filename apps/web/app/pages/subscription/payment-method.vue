<script setup lang="ts">
import { formatDate, formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
import { formatSubscriptionMoney } from '@/utils/subscription'

definePageMeta({ middleware: 'customer-commercial' })

const { t, locale } = useI18n()
const route = useRoute()
const api = useSubscriptionApi()
const { can } = useCustomerCapabilities()
const hydrated = useHydrated()
const allowed = computed(() => can('subscription.read'))
const manages = computed(() => can('subscription.manage'))
const { data, error, pending, refresh } = await useAsyncData('subscription:payment-method', api.subscription, { immediate: allowed.value })
const setting = computed(() => data.value?.auto_renew)
const setup = computed(() => setting.value?.state === 'setup' ? setting.value : null)
const charge = computed(() => setting.value?.state === 'on' ? setting.value.next_charge : null)
const setupLink = computed(() => setup.value ? { path: '/subscription/payment-method', query: { setup: setup.value.setup_id } } : undefined)
const confirmsSetup = computed(() => setup.value && route.query.setup === setup.value.setup_id)
const consent = ref(false)
const saving = ref(false)
const mutationError = ref(false)

async function update(action: 'enable' | 'complete' | 'off') {
  if (!manages.value || !hydrated.value || saving.value) return
  if (action === 'enable' && (!consent.value || !setting.value?.available)) return
  if (action === 'complete' && (!confirmsSetup.value || !setup.value?.available)) return
  saving.value = true
  mutationError.value = false
  try {
    data.value = action === 'complete' ? await api.completeAutoRenew(setup.value!.setup_id) : await api.setAutoRenew(action === 'enable')
    consent.value = false
    if (action !== 'enable') await navigateTo('/subscription/payment-method', { replace: true })
  } catch {
    mutationError.value = true
    await refresh()
  } finally { saving.value = false }
}
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('subscription.autoRenew.title')" back-to="/subscription" />
    <SharedForbiddenState v-if="!allowed" />
    <SharedPageState v-else :loading="pending" :error="error" @retry="refresh">
      <SharedRecordSection v-if="setting" variant="panel" :title="t('subscription.autoRenew.states.' + setting.state)">
        <div class="grid gap-(--liwan-gap-card)">
          <UAlert color="info" variant="subtle" :title="t('subscription.autoRenew.simulator')" :description="t('subscription.autoRenew.simulatorHint')" />
          <p v-if="!setting.available" class="text-sm text-muted">{{ t('subscription.autoRenew.unavailable') }}</p>
          <p v-else-if="!manages" class="text-sm text-muted">{{ t('subscription.autoRenew.readOnly') }}</p>

          <template v-if="setting.state === 'on'">
            <SharedPropertiesPanel v-if="charge">
              <SharedPropertyRow :label="t('subscription.autoRenew.nextDate')" :value="formatDate(charge.date)" />
              <SharedPropertyRow :label="t('subscription.autoRenew.nextAmount')" :value="formatSubscriptionMoney(charge.amount, locale)" />
              <SharedPropertyRow :label="t('subscription.autoRenew.notice')" :value="charge.notice_sent_at ? formatDateTime(charge.notice_sent_at, 'Asia/Riyadh') : t('subscription.autoRenew.noticePending')" />
            </SharedPropertiesPanel>
            <p v-else class="text-sm text-muted">{{ t('subscription.autoRenew.noCharge') }}</p>
          </template>

          <p v-if="setup" class="text-sm text-muted">
            {{ t('subscription.autoRenew.setupUntil', { date: formatDateTime(setup.setup_expires_at, 'Asia/Riyadh') }) }}
          </p>

          <UAlert v-if="mutationError" role="alert" color="error" variant="subtle" :title="t('subscription.autoRenew.failed')" />
          <template v-if="manages">
            <div v-if="setting.available && (setting.state === 'off' || setting.state === 'needs_new_method')" class="grid gap-(--liwan-gap-card)">
              <UCheckbox v-model="consent" :label="t('subscription.autoRenew.consent')" :disabled="!hydrated || saving" />
              <div><UButton :disabled="!hydrated || !consent || saving" :loading="saving" @click="update('enable')">{{ t('subscription.autoRenew.begin') }}</UButton></div>
            </div>
            <div v-else class="flex flex-wrap gap-(--liwan-gap-card)">
              <UButton v-if="setup?.available && confirmsSetup" :disabled="!hydrated || saving" :loading="saving" @click="update('complete')">
                {{ t('subscription.autoRenew.complete') }}
              </UButton>
              <UButton v-else-if="setup?.available" :to="setupLink" :disabled="!hydrated || saving">{{ t('subscription.autoRenew.continue') }}</UButton>
              <UButton v-if="setup || setting.state === 'on'" color="neutral" variant="outline" :disabled="!hydrated || saving" @click="update('off')">
                {{ t('subscription.autoRenew.off') }}
              </UButton>
            </div>
          </template>
        </div>
      </SharedRecordSection>
    </SharedPageState>
  </SharedSettingsPage>
</template>
