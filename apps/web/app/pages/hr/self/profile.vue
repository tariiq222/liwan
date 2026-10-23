<script setup lang="ts">
definePageMeta({ path: '/account/profile' })
import EmployeeProperties from '@/components/hr/EmployeeProperties.vue'
const { t } = useI18n()
const profile = useMyHrProfile()
const employee = computed(() => profile.data.value)
</script>

<template>
  <SharedRecordPage :title="t('hr.self.profile')" back-to="/account" :loading="profile.isLoading.value" :error="profile.error.value" @retry="profile.refetch">
    <SharedEmptyState v-if="employee === null" bordered :title="t('hr.self.noEmployee')" :description="t('hr.self.noEmployeeHint')" />
    <template v-if="employee">
      <SharedIdentityCard :id="employee.id" :name="employee.name" :subtitle="employee.job_title" />
    </template>
    <template v-if="employee" #aside>
      <EmployeeProperties :employee="employee" />
    </template>
  </SharedRecordPage>
</template>
