<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import PartnerForm from '@/components/finance/PartnerForm.vue'
import { useFinancePartner } from '@/composables/finance/useFinancePartners'

const route = useRoute()
const sourcePaths = useRecordListPaths(['/finance/partners'])
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.partnerId))
const query = useFinancePartner(id)
const partner = computed(() => query.data.value)
const canManage = computed(() => can('finance.partners.manage'))
// Child pages always return to their current record; the list's Edit action opens this page directly with returnTo, which is
// accepted only as exact list context, never as this editor's destination.
const backTo = computed(() => recordParentTo(`/finance/partners/${id.value}`, {
  ...route.query, listOrigin: route.query.listOrigin ?? route.query.returnTo ?? null,
}, sourcePaths.value, route.hash))
function saved() { void navigateTo(backTo.value) }
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('finance.partners.edit')" :back-to="backTo" />
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState v-else :loading="query.isLoading.value" :error="query.error.value" :empty="!partner" @retry="query.refetch">
      <PartnerForm v-if="partner" :partner="partner" :back-to="backTo" @saved="saved" />
    </SharedPageState>
  </SharedPageContainer>
</template>
