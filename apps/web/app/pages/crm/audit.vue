<script setup lang="ts">
import CrmAuditViewList from '@/components/crm/audit/CrmAuditViewList.vue'
import { useCrmAuditAccess } from '@/composables/crm/useCrmAudit'

const { t } = useI18n()
const allowed = useCrmAuditAccess()
</script>

<template>
  <SharedForbiddenState v-if="!allowed" />
  <SharedListPage v-else :title="t('crm.audit.title')">
    <CrmAuditViewList />
  </SharedListPage>
</template>
