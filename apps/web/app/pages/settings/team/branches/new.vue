<script setup lang="ts">
import BranchCreateForm from '@/components/access/branches/BranchCreateForm.vue'

const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const canCreate = computed(() => can('settings.company.manage') && me.value?.read_only === false)
// Owner decision 2026-10-29, option c: in SaaS a branch is bought, and the paid order creates it.
const purchaseOnly = computed(() => me.value?.commercial?.mode === 'saas')
</script>

<template>
  <SharedCreatePanel :title="t('access.branches.create.title')" :description="t('access.branches.create.description')" back-to="/settings/team/branches">
    <SharedForbiddenState v-if="!canCreate || purchaseOnly" :description="t('access.forbidden')" />
    <BranchCreateForm v-else @done="router.replace('/settings/team/branches')" @cancel="router.push('/settings/team/branches')" />
  </SharedCreatePanel>
</template>
