<script setup lang="ts">
import type { HrEmployee } from '@liwan/contracts'

// The employee record's facts as the aside PropertiesPanel. A missing value is the row's empty form
// (a dash, spoken as "no value"); the email and phone read left to right inside the Arabic page.
defineProps<{ employee: HrEmployee }>()
const { t } = useI18n()
</script>

<template>
  <SharedPropertiesPanel>
    <SharedPropertyRow :label="t('hr.card.jobTitle')" :value="employee.job_title" />
    <SharedPropertyRow :label="t('hr.card.department')" :value="employee.department?.name" />
    <SharedPropertyRow v-if="employee.work_email" :label="t('hr.card.email')"><bdi dir="ltr">{{ employee.work_email }}</bdi></SharedPropertyRow>
    <SharedPropertyRow v-else :label="t('hr.card.email')" />
    <SharedPropertyRow v-if="employee.work_phone" :label="t('hr.card.phone')"><bdi dir="ltr">{{ employee.work_phone }}</bdi></SharedPropertyRow>
    <SharedPropertyRow v-else :label="t('hr.card.phone')" />
    <SharedPropertyRow :label="t('hr.card.manager')" :value="employee.manager?.name" />
    <SharedPropertyRow v-if="employee.contract" :label="t('hr.card.nationality')" :value="employee.nationality?.name" />
  </SharedPropertiesPanel>
</template>
