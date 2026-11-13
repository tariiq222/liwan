<script setup lang="ts">
import type { TenantDeletion } from '@liwan/commercial-contracts'
import { daysBetween, riyadhDate } from '@liwan/commercial-contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
const props = defineProps<{ deletion: TenantDeletion | null; pending?: boolean; hydrated?: boolean; error?: string }>()
const emit = defineEmits<{ request: []; confirm: [input: { code: string; companyName: string }]; withdraw: [] }>()
const { t } = useI18n()
const code = ref('')
const companyName = ref('')
const blocked = computed(() => props.pending || props.hydrated === false)
const validCode = computed(() => /^\d{6}$/.test(code.value.trim()))
const canConfirm = computed(() => validCode.value && companyName.value.trim().length > 0 && !blocked.value)
const dueDate = computed(() => (props.deletion?.due_at ? formatDate(props.deletion.due_at, 'Asia/Riyadh') : ''))
// Counted in the browser only, so server and client render the same markup.
const today = ref<string | null>(null)
onMounted(() => { today.value = riyadhDate(new Date()) })
const daysLeft = computed(() => (today.value && props.deletion?.due_at ? Math.max(0, daysBetween(today.value, riyadhDate(props.deletion.due_at))) : null))
function submitConfirm() {
  if (!canConfirm.value) return
  emit('confirm', { code: code.value.trim(), companyName: companyName.value })
}
</script>
<template>
  <div class="space-y-4" data-slot="delete-workspace-panel" :data-state="deletion?.state ?? 'none'">
    <template v-if="!deletion || deletion.state === 'requested'">
      <p class="text-sm">{{ t('subscription.deletion.intro') }}</p>
      <ul class="list-disc space-y-1 ps-5 text-sm">
        <li>{{ t('subscription.deletion.deletes') }}</li>
        <li>{{ t('subscription.deletion.keeps') }}</li>
        <li>{{ t('subscription.deletion.window') }}</li>
        <li>{{ t('subscription.deletion.renewal') }}</li>
      </ul>
      <template v-if="!deletion">
        <p class="text-sm text-muted">{{ t('subscription.deletion.requestHint') }}</p>
        <UButton color="error" variant="outline" :disabled="blocked" :loading="pending" data-testid="request-deletion" @click="emit('request')">{{ t('subscription.deletion.request') }}</UButton>
      </template>
      <form v-else class="space-y-3" role="group" :aria-label="t('subscription.deletion.confirmTitle')" data-slot="delete-confirm" @submit.prevent="submitConfirm">
        <p class="font-medium">{{ t('subscription.deletion.confirmTitle') }}</p>
        <p class="text-sm text-muted">{{ t('subscription.deletion.codeSent') }}</p>
        <UFormField :label="t('subscription.deletion.codeLabel')">
          <UInput v-model="code" inputmode="numeric" autocomplete="one-time-code" :maxlength="6" :disabled="blocked" class="w-full" dir="ltr" />
        </UFormField>
        <UFormField :label="t('subscription.deletion.nameLabel')" :hint="t('subscription.deletion.nameHint')">
          <UInput v-model="companyName" autocomplete="off" :maxlength="200" :disabled="blocked" class="w-full" />
        </UFormField>
        <div class="flex flex-wrap gap-2">
          <UButton type="submit" color="error" :disabled="!canConfirm" :loading="pending" data-testid="confirm-deletion">{{ t('subscription.deletion.confirm') }}</UButton>
          <UButton color="neutral" variant="outline" :disabled="blocked" data-testid="resend-code" @click="emit('request')">{{ t('subscription.deletion.resend') }}</UButton>
          <UButton color="neutral" variant="ghost" :disabled="blocked" data-testid="cancel-request" @click="emit('withdraw')">{{ t('subscription.deletion.cancelRequest') }}</UButton>
        </div>
      </form>
    </template>
    <template v-else-if="deletion.state === 'confirmed'">
      <UAlert color="error" variant="subtle" icon="i-lucide-trash-2" data-testid="deletion-scheduled" :title="t('subscription.deletion.scheduledTitle', { date: dueDate })" :description="t('subscription.deletion.scheduledBody')" />
      <p v-if="daysLeft !== null" class="text-sm font-medium">{{ t('subscription.deletion.daysLeft', { count: daysLeft }) }}</p>
      <p class="text-sm text-muted">{{ t('subscription.deletion.deletes') }} {{ t('subscription.deletion.keeps') }}</p>
      <UButton color="neutral" variant="outline" :disabled="blocked" :loading="pending" data-testid="withdraw-deletion" @click="emit('withdraw')">{{ t('subscription.deletion.withdraw') }}</UButton>
      <p class="text-sm text-muted">{{ t('subscription.deletion.withdrawNote') }}</p>
    </template>
    <UAlert v-else color="error" variant="subtle" icon="i-lucide-trash-2" data-testid="deletion-due" :title="t('subscription.deletion.dueTitle', { date: dueDate })" :description="t('subscription.deletion.dueBody')" />
    <UAlert v-if="error" color="error" variant="subtle" role="alert" :title="error" />
  </div>
</template>
