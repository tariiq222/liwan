<script setup lang="ts">
import { useProject } from '@/composables/useProjects'
import RegisterForm from '@/components/project/governance/RegisterForm.vue'; import { safeReturnTo } from '@/utils/safeReturnTo'; const route = useRoute(); const router = useRouter(); const { t } = useI18n(); const id = Number(route.params.id); const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/projects/${id}/register`, ['/projects']))
const access = useProject(computed(() => Number(route.params.id)))
</script>
<template><SharedPageContainer width="form"><SharedPageHeader :title="t('projects.governance.registerForm.create')" :back-to="returnTo" /><SharedPageState :loading="access.isLoading.value" :error="access.error.value" @retry="access.refetch" /><p v-if="access.data.value && !access.data.value.can_manage" role="status">{{ t('projects.governance.readOnly') }}</p><section v-if="access.data.value?.can_manage" class="nasq-panel nasq-panel-body"><RegisterForm :project-id="id" @saved="() => router.push(returnTo)" @cancel="router.push(returnTo)" /></section></SharedPageContainer></template>
