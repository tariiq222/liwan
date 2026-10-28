<script setup lang="ts">
import CrmImportBatchList from '@/components/crm/imports/CrmImportBatchList.vue'
import CrmImportFlow from '@/components/crm/imports/CrmImportFlow.vue'

const { t } = useI18n()
const { can } = useAccess()
const IMPORTS_PATH = '/crm/imports'
</script>

<template>
  <SharedListPage :title="t('crm.imports.title')" hide-header>
    <CrmImportBatchList background />
  </SharedListPage>
  <SharedCreatePanel :title="t('crm.imports.flow.title')" :back-to="IMPORTS_PATH">
    <CrmImportFlow v-if="can('crm.leads.import')" :cancel-to="IMPORTS_PATH" />
    <SharedForbiddenState v-else />
  </SharedCreatePanel>
</template>
