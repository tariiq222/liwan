<script setup lang="ts">
// Shown once, straight after enrollment. Nothing here is stored: the codes exist only in the props.
defineProps<{ codes: string[], pending?: boolean }>()
const saved = defineModel<boolean>({ default: false })
defineEmits<{ continue: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="grid gap-4" data-slot="recovery-codes">
    <UAlert role="note" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('adminAuth.enroll.recoveryWarning')" />
    <ol dir="ltr" class="grid grid-cols-2 gap-2 rounded-md bg-elevated p-3 font-mono text-sm text-highlighted">
      <li v-for="code in codes" :key="code" class="select-all text-center">
        {{ code }}
      </li>
    </ol>
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
