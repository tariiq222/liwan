<script setup lang="ts">
import { useProject } from '@/composables/useProjects'

import StakeholderForm from '@/components/project/governance/StakeholderForm.vue'; import { useProjectStakeholder } from '@/composables/useProjectGovernance'; import { safeReturnTo } from '@/utils/safeReturnTo'
const route = useRoute(); const router = useRouter(); const { t } = useI18n(); const id = computed(() => Number(route.params.id)); const itemId = computed(() => Number(route.params.stakeholderId)); const item = useProjectStakeholder(id, itemId); const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/projects/${id.value}/stakeholders/${itemId.value}`, ['/projects']))

const access = useProject(computed(() => Number(route.params.id)))
</script>
<template><SharedPageContainer width="form"><SharedPageHeader :title="t('projects.governance.stakeholder.editTitle')" :back-to="returnTo" /><SharedPageState :loading="item.isLoading.value || access.isLoading.value" :error="item.error.value || access.error.value" :empty="!item.data.value" @retry="item.refetch" /><p v-if="access.data.value && !access.data.value.can_manage" role="status">{{ t('projects.governance.readOnly') }}</p><section v-if="item.data?.value && access.data.value?.can_manage" class="nasq-panel nasq-panel-body"><StakeholderForm :project-id="id" :stakeholder="item.data.value" @saved="() => router.push(returnTo)" @cancel="router.push(returnTo)" /></section></SharedPageContainer></template>
