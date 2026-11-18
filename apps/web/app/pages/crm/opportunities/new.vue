<script setup lang="ts">
import CrmOpportunityForm from '@/components/crm/opportunity/CrmOpportunityForm.vue'
import CrmOpportunityList from '@/components/crm/opportunity/CrmOpportunityList.vue'
import { useCrmSourceChoices } from '@/composables/crm/useCrmLists'
import { useCrmCreateAccess } from '@/composables/crm/useCrmAccess'
import { useCrmTerms } from '@/composables/crm/useCrmTerms'
import { useCreateCrmOpportunity } from '@/composables/crm/useOpportunities'
import { CRM_LIST_PATH, safeCrmReturnTo } from '@/utils/crmOpportunity'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const { term } = useCrmTerms()
const backTo = computed(() => safeCrmReturnTo(route.query.returnTo, CRM_LIST_PATH))
const sources = useCrmSourceChoices()
const create = useCreateCrmOpportunity()
const title = computed(() => t('crm.opportunities.list.new', { term: term('opportunity', 'one') }))
const { canCreate, manualOnly, pending } = useCrmCreateAccess()
</script>

<template>
  <SharedListPage :title="term('opportunity', 'other')" hide-header>
    <CrmOpportunityList background />
  </SharedListPage>
  <SharedCreatePanel :title="title" :back-to="backTo">
    <CrmOpportunityForm v-if="canCreate" :sources="sources.data.value?.items ?? []" :can-assign="can('crm.leads.assign')" :save="create.mutateAsync" :cancel-to="backTo" @saved="opportunity => navigateTo({ path: `${CRM_LIST_PATH}/${opportunity.id}`, query: { returnTo: backTo } }, { replace: true })" />
    <SharedForbiddenState v-else-if="!pending" :description="manualOnly ? t('crm.opportunities.createManualOnly') : undefined" data-testid="crm-create-forbidden" />
  </SharedCreatePanel>
</template>
