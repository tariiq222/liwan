<script setup lang="ts">
// Turning it on is a payment made with the customer's consent (the page pays the open invoice and keeps the method);
// turning it off forgets the stored method. Nothing here ever shows or sends the method itself.
defineProps<{ enabled: boolean; canManage: boolean; canEnable?: boolean; pending?: boolean; hydrated?: boolean }>()
const emit = defineEmits<{ enable: []; disable: [] }>()
import { RENEWAL_NOTICE_DAYS } from '@liwan/commercial-contracts'
const { t } = useI18n()
const consent = ref(false)
</script>
<template>
  <div class="space-y-3" data-slot="auto-renew">
    <p><SharedStatusBadge :tone="enabled ? 'success' : 'neutral'" variant="subtle" :label="t(enabled ? 'subscription.autoRenew.on' : 'subscription.autoRenew.off')" /></p>
    <p v-if="!canManage" class="text-sm text-muted">{{ t('subscription.autoRenew.readOnly') }}</p>
    <template v-else-if="!enabled">
      <template v-if="canEnable">
        <UCheckbox v-model="consent" :label="t('subscription.autoRenew.consent', { days: RENEWAL_NOTICE_DAYS })" :disabled="hydrated === false" />
        <UButton :disabled="!consent || pending || hydrated === false" :loading="pending" @click="emit('enable')">{{ t('subscription.autoRenew.enable') }}</UButton>
      </template>
      <p v-else class="text-sm text-muted">{{ t('subscription.autoRenew.enableHint') }}</p>
    </template>
    <template v-else>
      <p class="text-sm text-muted">{{ t('subscription.autoRenew.notice', { days: RENEWAL_NOTICE_DAYS }) }}</p>
      <UButton color="neutral" variant="outline" :disabled="pending || hydrated === false" :loading="pending" @click="emit('disable')">{{ t('subscription.autoRenew.disable') }}</UButton>
    </template>
  </div>
</template>
