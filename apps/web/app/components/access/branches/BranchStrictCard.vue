<script setup lang="ts">
import BranchStrictForm from '@/components/access/branches/BranchStrictForm.vue'
import { useBranchStrictness } from '@/composables/useBranchStrictness'

// One «stricter than the general policy» switch of a sensitive application. It can only narrow: on, the application's
// roles are never inherited into branches and only an explicit delegation opens a branch's records. The card stays
// hidden while the setting cannot be read, so an application without the route shows nothing.
const props = defineProps<{ scope: 'hr' | 'payroll' | 'finance'; path: string; canRead: boolean; canEdit: boolean }>()
const { t } = useI18n()
const { me } = useMe()
const identity = computed(() => me.value ? `${me.value.id}:${me.value.company.id}` : '')
const query = useBranchStrictness(props.path, () => props.canRead)
async function reload() {
  const result = await query.refetch()
  if (result.isError || !result.data) throw result.error ?? new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <BranchStrictForm v-if="query.data.value" :key="identity" :scope="scope" :path="path" :strictness="query.data.value" :can-edit="canEdit" :reload="reload" />
</template>
