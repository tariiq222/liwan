<script setup lang="ts">
import { useDocumentContexts } from '@/composables/useDocuments'
import DocumentCreateForm from '@/components/documents/DocumentCreateForm.vue'
import { documentRecordBack } from '@/lib/documentNavigation'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
const route = useRoute(); const router = useRouter(); const { t } = useI18n(); const { can } = useAccess()
const backTo = computed(() => documentRecordBack(route.query, route.hash))
const contexts = useDocumentContexts(computed(() => can('documents.items.manage')))
const initialContext = computed(() => typeof route.query.context_kind === 'string' && contexts.data.value?.items.some(item => item.kind === route.query.context_kind) && /^[1-9]\d*$/.test(String(route.query.context_id)) ? { kind: route.query.context_kind, id: Number(route.query.context_id) } : null)
async function saved(id: number) { await navigateTo({ path: `/documents/${id}`, query: returnToQuery(router.resolve(backTo.value).fullPath) }) }
</script>
<template>
  <SharedCreatePanel :title="t('documents.new')" :back-to="backTo">
    <SharedForbiddenState v-if="!can('documents.items.manage')" />
    <SharedPageState v-else :loading="contexts.isLoading.value" :error="contexts.error.value" @retry="contexts.refetch"><DocumentCreateForm :initial-context="initialContext" :back-to="backTo" @saved="saved" /></SharedPageState>
  </SharedCreatePanel>
</template>
