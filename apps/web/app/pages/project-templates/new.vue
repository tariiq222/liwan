<script setup lang="ts">
import ProjectTemplateEditor from '@/components/project/templates/ProjectTemplateEditor.vue'
import { useCreateProjectTemplate, useProjectTemplateList, useProjectTemplateNavigation } from '@/composables/useProjectTemplates'

const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const mutation = useCreateProjectTemplate()
const resetKey = ref(0)
const { backTo, templatePath } = useProjectTemplateNavigation()
const permissions = useProjectTemplateList({ limit: 1 })
async function save(body: Parameters<typeof mutation.mutate>[0]) {
  if (!permissions.data.value?.can_manage || mutation.isPending.value) return
  try {
    const item = await mutation.mutateAsync(body)
    resetKey.value += 1
    await nextTick()
    toast.add({ title: t('projects.templates.saved'), color: 'success', icon: 'i-lucide-circle-check' })
    await router.push(templatePath(item.id))
  } catch { /* Mutation error keeps the draft and unsaved guard intact. */ }
}
</script>

<template>
  <SharedPageContainer width="form"><SharedPageHeader :title="t('projects.templates.new')" :back-to="backTo" /><SharedPageState :loading="permissions.isLoading.value && !permissions.data.value" :error="permissions.data.value ? null : permissions.error.value" :empty="!permissions.isLoading.value && !permissions.error.value && !permissions.data.value?.can_manage" :empty-text="t('projects.forbidden')" @retry="permissions.refetch"><ProjectTemplateEditor :reset-key="resetKey" :busy="mutation.isPending.value" @save="save" @cancel="router.push(backTo)" /></SharedPageState><p v-if="mutation.error.value" role="alert" class="text-error">{{ t('projects.templates.saveError') }}</p></SharedPageContainer>
</template>
