<script setup lang="ts">
import ProjectTemplateEditor from '@/components/project/templates/ProjectTemplateEditor.vue'
import { useProjectTemplate, useUpdateProjectTemplate, useProjectTemplateNavigation } from '@/composables/useProjectTemplates'

const route = useRoute(); const router = useRouter(); const { t } = useI18n(); const toast = useToast()
const id = computed(() => { const value = Number(route.params.id); return Number.isInteger(value) && value > 0 ? value : null })
const { data: template, isLoading, error, refetch } = useProjectTemplate(id); const mutation = useUpdateProjectTemplate(); const resetKey = ref(0)
const { returnTo, templatePath } = useProjectTemplateNavigation()
async function save(patch: Parameters<typeof mutation.mutate>[0]['patch']) {
  if (!id.value || !template.value?.can_manage || mutation.isPending.value) return
  try {
    await mutation.mutateAsync({ id: id.value, patch })
    resetKey.value += 1
    await nextTick()
    toast.add({ title: t('projects.templates.saved'), color: 'success', icon: 'i-lucide-circle-check' })
    await router.push(templatePath(id.value))
  } catch { /* Keep the edited draft dirty on failure. */ }
}
</script>

<template><SharedPageContainer width="form"><SharedPageHeader :title="t('projects.templates.edit')" :back-to="id ? templatePath(id) : returnTo" /><SharedPageState :loading="isLoading && !template" :error="template ? null : error" :empty="!isLoading && !error && !template" :empty-text="t('projects.templates.notFound')" @retry="refetch"><p v-if="template && !template.can_manage" role="alert">{{ t('projects.forbidden') }}</p><ProjectTemplateEditor v-else-if="template" :reset-key="resetKey" :template="template" :busy="mutation.isPending.value" @save="save" @cancel="router.push(templatePath(template.id))" /></SharedPageState><p v-if="mutation.error.value" role="alert" class="text-error">{{ t('projects.templates.saveError') }}</p></SharedPageContainer></template>
