<script setup lang="ts">
const props = defineProps<{ enabled: boolean; canManage: boolean; pending?: boolean; hydrated?: boolean; needsCard?: boolean }>()
const emit = defineEmits<{ change: [enabled: boolean] }>()
const { t } = useI18n()
const consent = ref(false)
</script>
<template>
  <div class="space-y-3" data-slot="auto-renew">
    <p><SharedStatusBadge :tone="enabled ? 'success' : 'neutral'" variant="subtle" :label="t(enabled ? 'subscription.autoRenew.on' : 'subscription.autoRenew.off')" /></p>
    <p v-if="!canManage" class="text-sm text-muted">{{ t('subscription.autoRenew.readOnly') }}</p>
    <template v-else-if="needsCard && !enabled">
      <UButton disabled data-testid="auto-renew-needs-card">{{ t('subscription.autoRenew.enable') }}</UButton>
      <p class="text-sm text-muted" data-slot="needs-card">{{ t('subscription.autoRenew.needsCard') }}</p>
    </template>
    <template v-else-if="!enabled">
      <UCheckbox v-model="consent" :label="t('subscription.autoRenew.consent')" :disabled="hydrated === false" />
      <UButton :disabled="!consent || pending || hydrated === false" :loading="pending" @click="emit('change', true)">{{ t('subscription.autoRenew.enable') }}</UButton>
    </template>
    <UButton v-else color="neutral" variant="outline" :disabled="pending || hydrated === false" :loading="pending" @click="emit('change', false)">{{ t('subscription.autoRenew.disable') }}</UButton>
  </div>
</template>
