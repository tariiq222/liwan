<script setup lang="ts">
import ReportView from '@/components/finance/reports/ReportView.vue'
import { reportSlug } from '@/components/finance/reports/reportConfig'

// /finance/reports/{trial-balance,general-ledger,aged-partner-balance,partner-statement,vat,withholding}; any other slug is not found.
const route = useRoute()
const slug = computed(() => reportSlug(route.params.report))
</script>

<template>
  <ReportView v-if="slug" :key="slug" :slug="slug" />
  <SharedPageContainer v-else><SharedNotFoundState /></SharedPageContainer>
</template>
