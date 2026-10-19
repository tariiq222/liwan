<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import PartnerForm from '@/components/finance/PartnerForm.vue'
import { FINANCE_PARTNER_KINDS, parsePartnerListQuery } from '@/composables/finance/financePartnerParams'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const sourcePaths = useRecordListPaths(['/finance/partners'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const canManage = computed(() => can('finance.partners.manage'))
// Opened from a list filtered to customers or vendors, the new partner starts as that kind.
const initialKind = computed(() => parsePartnerListQuery(route.query).kind)
function created(partner: { id: number }) { void navigateTo({ path: `/finance/partners/${partner.id}`, query: { returnTo: router.resolve(backTo.value).fullPath } }, { replace: true }) }
</script>

<template>
  <SharedCreatePanel :title="t('finance.partners.createTitle')" :back-to="backTo">
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <PartnerForm v-else :back-to="backTo" :initial-kind="initialKind && FINANCE_PARTNER_KINDS.includes(initialKind) ? initialKind : null" @saved="created" />
  </SharedCreatePanel>
</template>
