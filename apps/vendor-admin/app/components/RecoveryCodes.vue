<script setup lang="ts">
import { useCopyLink } from '@/composables/useCopyLink'
// Shown once, straight after enrollment. Nothing here is stored: the codes exist only in the props.
const props = defineProps<{ codes: string[], pending?: boolean }>()
const saved = defineModel<boolean>({ default: false })
defineEmits<{ continue: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const copier = useCopyLink()
const allCodes = computed(() => props.codes.join('\n'))
const outcome = computed(() => copier.outcomeFor(allCodes.value))
</script>

<template>
  <div class="grid gap-4" data-slot="recovery-codes">
    <UAlert role="note" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('adminAuth.enroll.recoveryWarning')" />
    <ol dir="ltr" class="grid grid-cols-2 gap-2 rounded-inner bg-elevated p-3 font-mono text-sm text-highlighted">
      <li v-for="code in codes" :key="code" class="select-all text-center">
        {{ code }}
      </li>
    </ol>
    <div class="flex flex-wrap items-center gap-2">
      <UButton type="button" color="neutral" variant="outline" icon="i-lucide-copy" :disabled="!hydrated" :label="t('adminAuth.enroll.copyAll')" data-testid="recovery-codes-copy" @click="copier.copy(allCodes)" />
      <p role="status" class="text-sm" :class="outcome === 'failed' ? 'text-error' : 'text-success'">
        <template v-if="outcome">{{ t(outcome === 'copied' ? 'adminAuth.enroll.copied' : 'adminAuth.enroll.copyFailed') }}</template>
      </p>
    </div>
    <UCheckbox v-model="saved" :label="t('adminAuth.enroll.saved')" />
    <UButton
      type="button"
      block
      :label="t('adminAuth.enroll.continue')"
      :disabled="!saved"
      :loading="pending"
      @click="$emit('continue')"
    />
  </div>
</template>
