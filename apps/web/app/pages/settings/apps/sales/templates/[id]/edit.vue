<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import SalesTemplateForm from '@/components/sales/SalesTemplateForm.vue'
import { SALES_TEMPLATES_PATH } from '@/composables/sales/salesTemplateParams'
import { useSalesTemplateRecord } from '@/composables/sales/useSalesTemplateRecord'

const route = useRoute()
const router = useRouter()
const sourcePaths = useRecordListPaths([SALES_TEMPLATES_PATH])
const { t } = useI18n()
const { can } = useAccess()
useSettingsPage('sales')
const { id, query, template, loading, error, canManage } = useSalesTemplateRecord()
const backTo = computed(() => router.resolve(recordParentTo(`${SALES_TEMPLATES_PATH}/${id.value}`, route.query, sourcePaths.value, route.hash)).fullPath)
// DESIGN.md section 5: a saved form is not sent again through Back, so the record replaces the editor in the history.
function saved() { void navigateTo(backTo.value, { replace: true }) }
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('sales.templates.edit')" :back-to="backTo" />
    <SharedForbiddenState v-if="!can('sales.settings.manage')" />
    <SharedPageState v-else :loading="loading" :error="error" :empty="!template" @retry="query.refetch()">
      <SharedForbiddenState v-if="!canManage" />
      <SharedPageState v-else-if="template?.archived" :empty="true" :empty-text="t('sales.templates.archivedNotEditable')" />
      <SalesTemplateForm v-else-if="template" :template="template" :back-to="backTo" @saved="saved" />
    </SharedPageState>
  </SharedPageContainer>
</template>
