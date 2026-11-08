<script setup lang="ts">
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { useForgetDevices, useRememberedDevices } from './rememberedDevices'

// The browsers that skip the code step, with one inline confirmation to forget every other one. Nothing here is a
// secret: the server never sends a device token to page code, and the device in use is always kept.
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const { data, error, isPending, refetch } = useRememberedDevices()
const forget = useForgetDevices()
const confirming = ref(false)
const devices = computed(() => data.value?.items ?? [])

async function forgetOthers() {
  try {
    await forget.mutateAsync()
    confirming.value = false
    toast.add({ title: t('account.devicesForgotten'), color: 'success' })
  } catch {
    toast.add({ title: t('account.devicesForgetFailed'), color: 'error' })
  } finally {
    forget.reset()
  }
}
</script>

<template>
  <SharedFormSection panel :title="t('account.devicesTitle')" :description="t('account.devicesHint')">
    <div class="grid gap-4">
      <SharedPageState :loading="isPending" :error="error" @retry="refetch()">
        <p v-if="!devices.length" class="text-sm text-muted">{{ t('account.devicesEmpty') }}</p>
        <ul v-else class="divide-y divide-default">
          <li v-for="device in devices" :key="device.id" class="flex flex-wrap items-baseline justify-between gap-2 py-3" data-testid="account-device">
            <span class="text-sm font-medium text-highlighted">{{ device.label }}</span>
            <span class="text-xs text-muted">
              <template v-if="device.last_used_at">{{ t('account.deviceLastUsed') }}: {{ formatDate(device.last_used_at) }}</template>
              <template v-else-if="device.issued_at">{{ t('account.deviceAdded') }}: {{ formatDate(device.issued_at) }}</template>
            </span>
          </li>
        </ul>
      </SharedPageState>
      <SharedInlineConfirm
        v-if="confirming" :title="t('account.devicesForgetConfirm')" :description="t('account.devicesForgetConfirmHint')"
        :confirm-label="t('account.devicesForgetAll')" :pending="forget.isPending.value"
        data-testid="account-devices-confirm" @confirm="forgetOthers" @cancel="confirming = false"
      />
      <UButton
        v-else type="button" color="error" variant="outline" icon="i-lucide-shield-off"
        :label="t('account.devicesForgetAll')" :disabled="!hydrated || !devices.length"
        data-testid="account-devices-forget" @click="confirming = true"
      />
    </div>
  </SharedFormSection>
</template>
