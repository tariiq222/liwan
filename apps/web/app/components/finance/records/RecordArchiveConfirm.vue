<script setup lang="ts">
import { saveErrorMessage } from '@/utils/formFeedback'
import { archiveErrorKey } from './recordForms'

// Archiving a setup record, or bringing an archived one back, asks first. Nothing is deleted: its entries stay in the books.
// `scope` is the section's i18n key under `financeRecords` (accounts, journals, taxes, paymentTerms).
const props = defineProps<{
  scope: string
  name: string
  active: boolean
  /** Sends the archive (true) or the restore (false) and resolves when the server has answered. */
  send: (archive: boolean) => Promise<unknown>
  pending: boolean
}>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const failure = ref<unknown>(null)
const mode = computed(() => props.active ? 'archive' : 'unarchive')

const failureText = computed(() => {
  const key = archiveErrorKey(failure.value)
  return key ? t(key) : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))
})

async function submit() {
  try {
    await props.send(props.active)
    emit('done')
  } catch (error) { failure.value = error }
}
</script>

<template>
  <SharedInlineConfirm
    :color="active ? 'warning' : 'primary'"
    :title="t(`financeRecords.${scope}.confirm.${mode}Title`, { name })"
    :description="failure ? failureText : t(`financeRecords.${scope}.confirm.${mode}Description`)"
    :confirm-label="t(`financeRecords.actions.${mode}`)"
    :pending="pending"
    @confirm="submit"
    @cancel="emit('cancel')"
  />
</template>
