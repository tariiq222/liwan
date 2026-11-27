<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import AccountEditor from '@/components/finance/records/AccountEditor.vue'
import { useSetupAccount } from '@/composables/finance/useFinanceRecords'
import { queryPositiveInt } from '@/utils/routeQuery'

const LIST_PATH = '/settings/apps/finance/accounts'
const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const router = useRouter()
const canManage = computed(() => can('finance.accounts.manage'))
const id = computed(() => queryPositiveInt(route.params.id))
const query = useSetupAccount(id, canManage)
const backTo = computed(() => safeReturnTo(route.query.returnTo, LIST_PATH, [LIST_PATH]))
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader
      :title="t('financeRecords.accounts.editTitle')"
      :back-to="backTo"
      :back-label="t('financeRecords.accounts.title')"
    />
    <SharedForbiddenState v-if="!canManage" :description="t('financeRecords.forbidden')" />
    <SharedPageState
      v-else
      :loading="id !== null && query.isPending.value"
      :error="id === null ? { status: 404 } : query.error.value"
      @retry="query.refetch()"
    >
      <SharedFormSection v-if="query.data.value" panel>
        <AccountEditor
          :key="query.data.value.id"
          :account="query.data.value"
          @done="router.replace(backTo)"
          @cancel="router.push(backTo)"
        />
      </SharedFormSection>
    </SharedPageState>
  </SharedPageContainer>
</template>
