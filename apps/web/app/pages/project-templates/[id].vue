<script setup lang="ts">
import { Trash2, Pencil, Play } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useDeleteProjectTemplate, useProjectTemplate, useProjectTemplateNavigation } from '@/composables/useProjectTemplates'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => { const value = Number(route.params.id); return Number.isInteger(value) && value > 0 ? value : null })
const { data: template, isLoading, error, refetch } = useProjectTemplate(id)
const remove = useDeleteProjectTemplate()
const confirmDelete = ref(false)
const { returnTo, templatePath } = useProjectTemplateNavigation()
const isBaseRoute = computed(() => route.path.replace(/\/+$/, '') === `/project-templates/${id.value}`)
function deleteTemplate() { if (!id.value) return; remove.mutate(id.value, { onSuccess: () => { toast.success(t('projects.templates.deleted')); router.push(returnTo.value) } }) }
</script>

<template>
  <SharedPageContainer v-if="isBaseRoute" width="detail">
    <SharedPageHeader :title="template?.name ?? t('projects.templates.title')" :description="template?.description" :back-to="returnTo">
      <template #actions>
        <div class="flex flex-wrap gap-2"><Button v-if="template?.can_apply" :disabled="!hydrated || remove.isPending.value" @click="router.push(templatePath(template.id, 'apply'))"><Play class="me-2 size-4" />{{ t('projects.templates.actions.apply') }}</Button><Button v-if="template?.can_manage" variant="outline" :disabled="!hydrated || remove.isPending.value" @click="router.push(templatePath(template.id, 'edit'))"><Pencil class="me-2 size-4" />{{ t('projects.templates.actions.edit') }}</Button><Button v-if="template?.can_manage" variant="outline" :disabled="!hydrated || remove.isPending.value" @click="confirmDelete = true"><Trash2 class="me-2 size-4" />{{ t('projects.templates.actions.delete') }}</Button></div>
      </template>
    </SharedPageHeader>
    <SharedPageState :loading="isLoading && !template" :error="template ? null : error" :empty="!isLoading && !error && !template" :empty-text="t('projects.templates.notFound')" @retry="refetch">
      <template v-if="template">

        <div v-if="confirmDelete" class="rounded-lg border border-destructive/40 bg-destructive/5 p-4"><p class="text-sm">{{ t('projects.templates.deleteConfirm') }}</p><div class="mt-3 flex gap-2"><Button :disabled="!hydrated || remove.isPending.value" variant="destructive" @click="deleteTemplate">{{ t('projects.templates.actions.confirmDelete') }}</Button><Button variant="ghost" :disabled="!hydrated || remove.isPending.value" @click="confirmDelete = false">{{ t('app.cancel') }}</Button></div></div><p v-if="remove.error.value" role="alert" class="text-destructive">{{ t('projects.templates.saveError') }}</p>
        <div class="grid gap-4 md:grid-cols-3"><Card><CardContent class="p-4"><p class="text-sm text-muted-foreground">{{ t('projects.templates.stages.title') }}</p><p class="mt-1 text-2xl font-semibold">{{ template.definition.stages.length }}</p></CardContent></Card><Card><CardContent class="p-4"><p class="text-sm text-muted-foreground">{{ t('projects.templates.tasks.title') }}</p><p class="mt-1 text-2xl font-semibold">{{ template.definition.tasks.length }}</p></CardContent></Card><Card><CardContent class="p-4"><p class="text-sm text-muted-foreground">{{ t('projects.templates.milestones.title') }}</p><p class="mt-1 text-2xl font-semibold">{{ template.definition.milestones.length }}</p></CardContent></Card></div>
        <div class="grid gap-4 md:grid-cols-3"><Card><CardContent class="space-y-2 p-4"><h2 class="font-medium">{{ t('projects.templates.stages.title') }}</h2><p v-for="stage in template.definition.stages" :key="stage.key" class="text-sm">{{ stage.name }}</p></CardContent></Card><Card><CardContent class="space-y-2 p-4"><h2 class="font-medium">{{ t('projects.templates.milestones.title') }}</h2><p v-if="!template.definition.milestones.length" class="text-sm text-muted-foreground">{{ t('projects.templates.emptyMilestones') }}</p><p v-for="milestone in template.definition.milestones" :key="milestone.key" class="flex justify-between gap-2 text-sm"><span>{{ milestone.name }}</span><span class="text-muted-foreground">{{ milestone.offset_days }} {{ t('projects.templates.fields.offsetDays') }}</span></p></CardContent></Card><Card><CardContent class="space-y-2 p-4"><h2 class="font-medium">{{ t('projects.templates.tasks.title') }}</h2><p v-if="!template.definition.tasks.length" class="text-sm text-muted-foreground">{{ t('projects.templates.emptyTasks') }}</p><p v-for="task in template.definition.tasks" :key="task.key" class="flex justify-between gap-2 text-sm"><span>{{ task.name }}</span><span class="text-muted-foreground">{{ task.duration_days }} {{ t('projects.templates.days') }}</span></p></CardContent></Card></div>
      </template>
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage />
</template>
