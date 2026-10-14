<script setup lang="ts">
import { useDeleteProjectTemplate, useProjectTemplate, useProjectTemplateNavigation } from '@/composables/useProjectTemplates'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const id = computed(() => { const value = Number(route.params.id); return Number.isInteger(value) && value > 0 ? value : null })
const { data: template, isLoading, error, refetch } = useProjectTemplate(id)
const remove = useDeleteProjectTemplate()
const confirmDelete = ref(false)
const { backTo, templatePath } = useProjectTemplateNavigation()
const isBaseRoute = computed(() => route.path.replace(/\/+$/, '') === `/project-templates/${id.value}`)
function deleteTemplate() { if (!id.value) return; remove.mutate(id.value, { onSuccess: () => { toast.add({ title: t('projects.templates.deleted'), color: 'success', icon: 'i-lucide-circle-check' }); router.push(backTo.value) } }) }
</script>

<template>
  <SharedRecordPage
    v-if="isBaseRoute"
    :title="template?.name ?? t('projects.templates.title')"
    :description="template?.description"
    :back-to="backTo"
    :loading="isLoading && !template"
    :error="template ? null : error"
    @retry="refetch"
  >
    <template v-if="template" #actions>
      <UButton v-if="template.can_apply" icon="i-lucide-play" :disabled="!hydrated || remove.isPending.value" @click="router.push(templatePath(template.id, 'apply'))">{{ t('projects.templates.actions.apply') }}</UButton>
      <UButton v-if="template.can_manage" color="neutral" variant="outline" icon="i-lucide-pencil" :disabled="!hydrated || remove.isPending.value" @click="router.push(templatePath(template.id, 'edit'))">{{ t('projects.templates.actions.edit') }}</UButton>
      <UButton v-if="template.can_manage" color="error" variant="outline" icon="i-lucide-trash-2" :disabled="!hydrated || remove.isPending.value" @click="confirmDelete = true">{{ t('projects.templates.actions.delete') }}</UButton>
    </template>
    <template v-if="template">
      <SharedInlineConfirm v-if="confirmDelete" data-testid="template-delete-confirm" :title="t('projects.templates.deleteConfirm')" :confirm-label="t('projects.templates.actions.confirmDelete')" :pending="remove.isPending.value" @cancel="confirmDelete = false" @confirm="deleteTemplate" />
      <p v-if="remove.error.value" role="alert" class="text-error">{{ t('projects.templates.saveError') }}</p>
      <SharedRecordSection id="template-stages" :title="`${t('projects.templates.stages.title')} (${template.definition.stages.length})`">
        <p v-for="stage in template.definition.stages" :key="stage.key" class="text-sm">{{ stage.name }}</p>
      </SharedRecordSection>
      <SharedRecordSection id="template-milestones" :title="`${t('projects.templates.milestones.title')} (${template.definition.milestones.length})`">
        <p v-if="!template.definition.milestones.length" class="text-sm text-muted">{{ t('projects.templates.emptyMilestones') }}</p>
        <p v-for="milestone in template.definition.milestones" :key="milestone.key" class="flex justify-between gap-2 text-sm"><span>{{ milestone.name }}</span><span class="text-muted">{{ milestone.offset_days }} {{ t('projects.templates.fields.offsetDays') }}</span></p>
      </SharedRecordSection>
      <SharedRecordSection id="template-tasks" :title="`${t('projects.templates.tasks.title')} (${template.definition.tasks.length})`">
        <p v-if="!template.definition.tasks.length" class="text-sm text-muted">{{ t('projects.templates.emptyTasks') }}</p>
        <p v-for="task in template.definition.tasks" :key="task.key" class="flex justify-between gap-2 text-sm"><span>{{ task.name }}</span><span class="text-muted">{{ task.duration_days }} {{ t('projects.templates.days') }}</span></p>
      </SharedRecordSection>
    </template>
    <SharedEmptyState v-else-if="!isLoading && !error" :title="t('projects.templates.notFound')" />
    <template v-if="template" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('projects.templates.stages.title')" :value="template.definition.stages.length" />
        <SharedPropertyRow :label="t('projects.templates.milestones.title')" :value="template.definition.milestones.length" />
        <SharedPropertyRow :label="t('projects.templates.tasks.title')" :value="template.definition.tasks.length" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
  <NuxtPage />
</template>
