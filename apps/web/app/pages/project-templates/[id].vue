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
  <SharedPageContainer v-if="isBaseRoute" width="detail">
    <SharedPageHeader :title="template?.name ?? t('projects.templates.title')" :description="template?.description" :back-to="backTo">
      <template #actions>
        <div class="flex flex-wrap gap-2"><UButton v-if="template?.can_apply" icon="i-lucide-play" :disabled="!hydrated || remove.isPending.value" @click="router.push(templatePath(template.id, 'apply'))">{{ t('projects.templates.actions.apply') }}</UButton><UButton v-if="template?.can_manage" color="neutral" variant="outline" icon="i-lucide-pencil" :disabled="!hydrated || remove.isPending.value" @click="router.push(templatePath(template.id, 'edit'))">{{ t('projects.templates.actions.edit') }}</UButton><UButton v-if="template?.can_manage" color="error" variant="outline" icon="i-lucide-trash-2" :disabled="!hydrated || remove.isPending.value" @click="confirmDelete = true">{{ t('projects.templates.actions.delete') }}</UButton></div>
      </template>
    </SharedPageHeader>
    <SharedPageState :loading="isLoading && !template" :error="template ? null : error" :empty="!isLoading && !error && !template" :empty-text="t('projects.templates.notFound')" @retry="refetch">
      <template v-if="template">

        <SharedInlineConfirm
          v-if="confirmDelete"
          data-testid="template-delete-confirm"
          :title="t('projects.templates.deleteConfirm')"
          :confirm-label="t('projects.templates.actions.confirmDelete')"
          :pending="remove.isPending.value"
          @cancel="confirmDelete = false"
          @confirm="deleteTemplate"
        />
        <p v-if="remove.error.value" role="alert" class="text-error">{{ t('projects.templates.saveError') }}</p>
        <div class="grid gap-4 xl:grid-cols-3">
          <section class="rounded-lg ring ring-default bg-default overflow-hidden" aria-labelledby="template-stages-title">
            <div class="border-b border-default px-5 py-4"><h2 id="template-stages-title" class="text-lg font-semibold text-highlighted">{{ t('projects.templates.stages.title') }} <span class="text-sm text-muted tabular-nums">({{ template.definition.stages.length }})</span></h2></div>
            <div class="p-5 space-y-2"><p v-for="stage in template.definition.stages" :key="stage.key" class="text-sm">{{ stage.name }}</p></div>
          </section>
          <section class="rounded-lg ring ring-default bg-default overflow-hidden" aria-labelledby="template-milestones-title">
            <div class="border-b border-default px-5 py-4"><h2 id="template-milestones-title" class="text-lg font-semibold text-highlighted">{{ t('projects.templates.milestones.title') }} <span class="text-sm text-muted tabular-nums">({{ template.definition.milestones.length }})</span></h2></div>
            <div class="p-5 space-y-2"><p v-if="!template.definition.milestones.length" class="text-sm text-muted">{{ t('projects.templates.emptyMilestones') }}</p><p v-for="milestone in template.definition.milestones" :key="milestone.key" class="flex justify-between gap-2 text-sm"><span>{{ milestone.name }}</span><span class="text-muted">{{ milestone.offset_days }} {{ t('projects.templates.fields.offsetDays') }}</span></p></div>
          </section>
          <section class="rounded-lg ring ring-default bg-default overflow-hidden" aria-labelledby="template-tasks-title">
            <div class="border-b border-default px-5 py-4"><h2 id="template-tasks-title" class="text-lg font-semibold text-highlighted">{{ t('projects.templates.tasks.title') }} <span class="text-sm text-muted tabular-nums">({{ template.definition.tasks.length }})</span></h2></div>
            <div class="p-5 space-y-2"><p v-if="!template.definition.tasks.length" class="text-sm text-muted">{{ t('projects.templates.emptyTasks') }}</p><p v-for="task in template.definition.tasks" :key="task.key" class="flex justify-between gap-2 text-sm"><span>{{ task.name }}</span><span class="text-muted">{{ task.duration_days }} {{ t('projects.templates.days') }}</span></p></div>
          </section>
        </div>
      </template>
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage />
</template>
