<script setup lang="ts">
// The authenticator setup: the key to type and the otpauth link to open (no QR code, so no extra dependency).
defineProps<{ uri: string | null, secret: string | null, loading?: boolean }>()
defineEmits<{ retry: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="grid gap-3" data-slot="totp-setup">
    <p v-if="!uri" class="text-sm text-muted" role="status">
      {{ t('adminAuth.enroll.totpLoading') }}
    </p>
    <template v-else>
      <div class="grid gap-1">
        <p class="text-sm font-medium text-highlighted">
          {{ t('adminAuth.enroll.setupKey') }}
        </p>
        <code v-if="secret" dir="ltr" class="select-all rounded-md bg-elevated px-3 py-2 text-center font-mono text-base tracking-wider text-highlighted">{{ secret }}</code>
        <p class="text-xs text-muted">
          {{ t('adminAuth.enroll.setupKeyHint') }}
        </p>
      </div>
      <UButton
        v-if="uri.startsWith('otpauth://')"
        :href="uri"
        variant="outline"
        color="neutral"
        icon="i-lucide-external-link"
        class="justify-center"
        :label="t('adminAuth.enroll.openLink')"
      />
    </template>
    <UButton
      v-if="!uri && !loading"
      type="button"
      variant="outline"
      color="neutral"
      class="justify-center"
      :label="t('adminAuth.enroll.retry')"
      @click="$emit('retry')"
    />
  </div>
</template>
