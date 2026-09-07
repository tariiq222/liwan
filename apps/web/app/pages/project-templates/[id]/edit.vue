<script setup lang="ts">
import { toast } from 'vue-sonner'
import ProjectTemplateEditor from '@/components/project/templates/ProjectTemplateEditor.vue'
import { useProjectTemplate, useUpdateProjectTemplate, useProjectTemplateNavigation } from '@/composables/useProjectTemplates'

const route = useRoute(); const router = useRouter(); const { t } = useI18n()
const id = computed(() => { const value = Number(route.params.id); return Number.isInteger(value) && value > 0 ? value : null })
const { data: template, isPending, error } = useProjectTemplate(id); const mutation = useUpdateProjectTemplate(); const resetKey = ref(0)
const { returnTo, templatePath } = useProjectTemplateNavigation()
async function save(patch: Parameters<typeof mutation.mutate>[0]['patch']) {
  if (!id.value || !template.value?.can_manage || mutation.isPending.value) return
  try {
    await mutation.mutateAsync({ id: id.value, patch })
    resetKey.value += 1
    await nextTick()
    toast.success(t('projects.templates.saved'))
    await router.push(templatePath(id.value))
  } catch { /* Keep the edited draft dirty on failure. */ }
}
</script>

<template><SharedPageContainer width="form"><SharedPageHeader :title="t('projects.templates.edit')" :back-to="id ? templatePath(id) : returnTo" /><p v-if="isPending && !template" role="status" class="text-muted-foreground">{{ t('projects.loading') }}</p><p v-else-if="error || !template" role="alert" class="text-destructive">{{ t('projects.templates.notFound') }}</p><p v-else-if="!template.can_manage" role="alert">{{ t('projects.forbidden') }}</p><Card v-else class="nasq-form"><CardContent><ProjectTemplateEditor :reset-key="resetKey" :template="template" :busy="mutation.isPending.value" @save="save" @cancel="router.push(templatePath(template.id))" /></CardContent></Card><p v-if="mutation.error.value" role="alert" class="text-destructive">{{ t('projects.templates.saveError') }}</p></SharedPageContainer></template>
