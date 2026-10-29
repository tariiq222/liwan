<script setup lang="ts">
import InboxTemplateForm from '@/components/inbox/InboxTemplateForm.vue'
import InboxTemplateList from '@/components/inbox/InboxTemplateList.vue'

// Create a template: the route-backed create panel over the channel's templates list. Meta reviews it after it is saved.
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => {
  const value = Number(route.params.id)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const backTo = computed(() => ({ path: `/settings/apps/inbox/channels/${id.value}/templates`, query: route.query }))
</script>

<template>
  <template v-if="id">
    <SharedRecordPage :title="t('inbox.templates.title')" hide-header><InboxTemplateList :channel-id="id" /></SharedRecordPage>
    <SharedCreatePanel :title="t('inbox.templates.create')" :description="t('inbox.templates.createHint')" :back-to="backTo">
      <InboxTemplateForm v-if="can('inbox.templates.manage')" :channel-id="id" :back-to="`/settings/apps/inbox/channels/${id}/templates`" @saved="template => navigateTo({ path: `/settings/apps/inbox/channels/${id}/templates/${template.id}` }, { replace: true })" />
      <SharedForbiddenState v-else />
    </SharedCreatePanel>
  </template>
  <SharedNotFoundState v-else />
</template>
