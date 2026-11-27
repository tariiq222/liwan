<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import TaxEditor from '@/components/finance/records/TaxEditor.vue'
import { useSetupTax } from '@/composables/finance/useFinanceRecords'
import { queryPositiveInt } from '@/utils/routeQuery'

const LIST_PATH = '/settings/apps/finance/taxes'
const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const router = useRouter()
const canManage = computed(() => can('finance.taxes.manage'))
const id = computed(() => queryPositiveInt(route.params.id))
const query = useSetupTax(id, canManage)
const backTo = computed(() => safeReturnTo(route.query.returnTo, LIST_PATH, [LIST_PATH]))
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader
      :title="t('financeRecords.taxes.editTitle')"
      :back-to="backTo"
      :back-label="t('financeRecords.taxes.title')"
    />
    <SharedForbiddenState v-if="!canManage" :description="t('financeRecords.forbidden')" />
    <SharedPageState
      v-else
      :loading="id !== null && query.isPending.value"
      :error="id === null ? { status: 404 } : query.error.value"
      @retry="query.refetch()"
    >
      <SharedFormSection v-if="query.data.value" panel>
        <TaxEditor
          :key="query.data.value.id"
          :tax="query.data.value"
          @done="router.replace(backTo)"
          @cancel="router.push(backTo)"
        />
      </SharedFormSection>
    </SharedPageState>
  </SharedPageContainer>
</template>
