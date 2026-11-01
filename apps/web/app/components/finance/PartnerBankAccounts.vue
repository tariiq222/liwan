<script setup lang="ts">
import type { FinancePartnerBank } from '@liwan/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { useArchiveFinancePartnerBank, useFinancePartnerBanks } from '@/composables/finance/useFinancePartnerBanks'
import PartnerBankForm from './PartnerBankForm.vue'

// The bank accounts of a partner on its record page: where payments to or from it go. Archived accounts stay listed (a past
// payment may have used one) and can be restored; nothing is deleted. Adding, editing and archiving belong to
// finance.partners.manage, and archiving asks inline first.
const props = defineProps<{ partnerId: number; canManage: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const banks = useFinancePartnerBanks(() => props.partnerId)
const items = computed(() => banks.data.value?.items ?? [])

/** `new` while the add form is open, an account id while that account is edited. */
const editing = ref<'new' | number | null>(null)
const confirming = ref<FinancePartnerBank | null>(null)
const archiveFailure = ref<unknown>(null)
const { mutateAsync: sendArchive, isPending: archiving } = useArchiveFinancePartnerBank(() => props.partnerId)

function startEdit(target: 'new' | number) {
  confirming.value = null
  editing.value = target
}
function startArchive(account: FinancePartnerBank) {
  editing.value = null
  archiveFailure.value = null
  confirming.value = account
}
async function toggleArchive() {
  const account = confirming.value
  if (!account || !hydrated.value || archiving.value) return
  try {
    await sendArchive({ id: account.id, archive: account.active })
    confirming.value = null
    archiveFailure.value = null
  } catch (cause) { archiveFailure.value = cause }
}
const archiveDescription = computed(() => archiveFailure.value
  ? saveErrorMessage(archiveFailure.value, t('errors.generic'), t('errors.saveUncertain'))
  : t('finance.partners.banks.archiveHint'))
const title = (account: FinancePartnerBank) => account.bank_name || t('finance.partners.banks.unnamedBank')
</script>

<template>
  <SharedRecordSection id="bank-accounts" variant="list" :title="t('finance.partners.banks.title')" :description="t('finance.partners.banks.hint')" data-testid="finance-partner-banks">
    <template v-if="canManage" #actions>
      <UButton v-if="editing !== 'new'" color="neutral" variant="outline" size="sm" icon="i-lucide-plus" :disabled="!hydrated" :label="t('finance.partners.banks.add')" data-testid="finance-partner-bank-add" @click="startEdit('new')" />
    </template>
    <PartnerBankForm v-if="editing === 'new'" :partner-id="partnerId" @done="editing = null" @cancel="editing = null" />
    <SharedPageState :loading="banks.isLoading.value" :error="banks.error.value" :keep-content="items.length > 0" @retry="banks.refetch">
      <SharedEmptyState v-if="!items.length && editing !== 'new'" class="m-(--liwan-card-pad-dense)" :title="t('finance.partners.banks.empty')" />
      <template v-for="account in items" :key="account.id">
        <PartnerBankForm v-if="editing === account.id" :partner-id="partnerId" :account="account" @done="editing = null" @cancel="editing = null" />
        <div v-else class="grid gap-3 p-(--liwan-card-pad)" :data-testid="`finance-partner-bank-${account.id}`">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="flex flex-wrap items-center gap-2 font-semibold text-highlighted">
                <span>{{ title(account) }}</span>
                <SharedStatusBadge v-if="!account.active" size="sm" tone="neutral" :label="t('finance.partners.status.archived')" />
              </p>
              <p class="text-sm tabular-nums" dir="ltr"><bdi>{{ account.acc_number }}</bdi></p>
              <p v-if="account.holder_name || account.bic" class="text-sm text-muted">
                <span v-if="account.holder_name">{{ account.holder_name }}</span>
                <span v-if="account.holder_name && account.bic"> · </span>
                <bdi v-if="account.bic">{{ account.bic }}</bdi>
              </p>
            </div>
            <div v-if="canManage" class="flex flex-wrap items-center gap-2">
              <UButton v-if="account.active" color="neutral" variant="ghost" size="sm" icon="i-lucide-pencil" :disabled="!hydrated" :label="t('app.edit')" :aria-label="t('finance.partners.banks.editAria', { name: title(account) })" @click="startEdit(account.id)" />
              <UButton color="neutral" variant="ghost" size="sm" :icon="account.active ? 'i-lucide-archive' : 'i-lucide-archive-restore'" :disabled="!hydrated" :label="t(account.active ? 'finance.partners.banks.archive' : 'finance.partners.banks.unarchive')" @click="startArchive(account)" />
            </div>
          </div>
          <SharedInlineConfirm
            v-if="confirming?.id === account.id"
            :color="account.active ? 'warning' : 'primary'"
            :title="t(account.active ? 'finance.partners.banks.archiveConfirm' : 'finance.partners.banks.unarchiveConfirm', { name: title(account) })"
            :description="archiveDescription"
            :confirm-label="t(account.active ? 'finance.partners.banks.archive' : 'finance.partners.banks.unarchive')"
            :pending="archiving"
            @confirm="toggleArchive"
            @cancel="confirming = null; archiveFailure = null"
          />
        </div>
      </template>
    </SharedPageState>
  </SharedRecordSection>
</template>
