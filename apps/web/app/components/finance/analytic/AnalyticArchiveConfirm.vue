<script setup lang="ts">
import type { FinanceAnalyticAccount } from '@liwan/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { usePatchAnalyticAccount } from '@/composables/finance/useFinanceAnalytic'

// Archiving a cost center, or bringing an archived one back, asks first. There is no delete: the items it holds stay in the books.
const props = defineProps<{ account: FinanceAnalyticAccount }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const failure = ref<unknown>(null)
const { mutateAsync: patch, isPending } = usePatchAnalyticAccount()
const mode = computed(() => props.account.active ? 'archive' : 'unarchive')

async function submit() {
  try {
    await patch({ id: props.account.id, patch: { active: !props.account.active } })
    emit('done')
  } catch (error) { failure.value = error }
}
</script>

<template>
  <SharedInlineConfirm
    :color="account.active ? 'warning' : 'primary'"
    :title="t(`financeAnalytic.accounts.confirm.${mode}Title`, { name: account.name })"
    :description="failure ? saveErrorMessage(failure, t('errors.generic'), t('errors.saveUncertain')) : t(`financeAnalytic.accounts.confirm.${mode}Description`)"
    :confirm-label="t(`financeAnalytic.accounts.actions.${mode}`)"
    :pending="isPending"
    @confirm="submit"
    @cancel="emit('cancel')"
  />
</template>
