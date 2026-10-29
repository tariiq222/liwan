<script setup lang="ts">
import CrmImportBatchList from '@/components/crm/imports/CrmImportBatchList.vue'

const { t } = useI18n()
</script>

<template>
  <SharedListPage :title="t('crm.imports.title')" :create-to="{ path: '/crm/imports/new' }" :create-label="t('crm.imports.new')">
    <CrmImportBatchList />
  </SharedListPage>
</template>
