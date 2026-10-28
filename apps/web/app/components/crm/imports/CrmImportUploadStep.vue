<script setup lang="ts">
import { IMPORT_ACCEPT } from '@/utils/crmImport'

// Step 1: choose the CSV or XLSX file. The parent reads it and moves on to the mapping, or says why the file was refused.
defineProps<{ reading?: boolean; error?: string }>()
const emit = defineEmits<{ choose: [file: File] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const field = ref<{ reset: () => void } | null>(null)

function onChange(event: Event) {
  const file = (event.target as HTMLInputElement | null)?.files?.[0]
  if (file) emit('choose', file)
}
defineExpose({ reset: () => field.value?.reset() })
</script>

<template>
  <div class="grid gap-3" data-testid="crm-import-upload">
    <p class="text-sm text-muted">{{ t('crm.imports.flow.upload.hint') }}</p>
    <SharedFileField ref="field" :accept="IMPORT_ACCEPT" :label="t('crm.imports.flow.upload.choose')" :show-file-name="false" :disabled="!hydrated || reading" @change="onChange" />
    <p v-if="reading" class="text-sm text-muted" role="status">{{ t('crm.imports.flow.upload.reading') }}</p>
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :description="error" data-testid="crm-import-file-error" />
  </div>
</template>
