<script setup lang="ts">
import SalesTemplateDirectory from '@/components/sales/SalesTemplateDirectory.vue'
import SalesTemplateForm from '@/components/sales/SalesTemplateForm.vue'
import { SALES_TEMPLATES_PATH } from '@/composables/sales/salesTemplateParams'
import { safeListReturnTo } from '@/composables/useRouteListFilters'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
useSettingsPage('sales')
const backTo = computed(() => safeListReturnTo(SALES_TEMPLATES_PATH, route.query.returnTo))
function opened(id: number) { void navigateTo({ path: `${SALES_TEMPLATES_PATH}/${id}`, query: { returnTo: backTo.value } }, { replace: true }) }
</script>

<template>
  <SharedListPage :title="t('sales.templates.title')" hide-header>
    <SalesTemplateDirectory background />
  </SharedListPage>
  <SharedCreatePanel :title="t('sales.templates.new')" :back-to="backTo">
    <SharedForbiddenState v-if="!can('sales.settings.manage')" />
    <SalesTemplateForm v-else :back-to="backTo" @saved="template => opened(template.id)" />
  </SharedCreatePanel>
</template>
