<script setup lang="ts">
import { toast } from 'vue-sonner'
import { useApplyProjectTemplate, useProjectTemplate, useProjectTemplateNavigation } from '@/composables/useProjectTemplates'
import { ProjectTemplateApplySchema } from '@nasq/contracts'

const route = useRoute(); const router = useRouter(); const { t } = useI18n(); const hydrated = useHydrated()
const id = computed(() => { const value = Number(route.params.id); return Number.isInteger(value) && value > 0 ? value : null })
const { data: template, isPending, error } = useProjectTemplate(id); const mutation = useApplyProjectTemplate()
const { returnTo, templatePath } = useProjectTemplateNavigation()
const name = ref(''); const startDate = ref(''); const saved = ref(false)
const baseline = ref(''); const initialized = ref(false); const validationError = ref('')
const serialized = () => JSON.stringify({ name: name.value, start_date: startDate.value })
const dirty = computed(() => initialized.value && !saved.value && serialized() !== baseline.value)
watch(template, value => {
  if (value && !initialized.value) {
    name.value = value.name
    baseline.value = serialized()
    initialized.value = true
  }
}, { immediate: true })
async function apply() {
  if (!id.value || !hydrated.value || mutation.isPending.value || !template.value?.can_apply) return
  const parsed = ProjectTemplateApplySchema.safeParse({ name: name.value, start_date: startDate.value })
  validationError.value = parsed.success ? '' : t('projects.templates.validation.applyFields')
  if (!parsed.success) return
  try {
    const project = await mutation.mutateAsync({ id: id.value, body: parsed.data })
    saved.value = true
    await nextTick()
    toast.success(t('projects.templates.applied'))
    await router.push(`/projects/${project.id}`)
  } catch { /* Failed application retains inputs and dirty state. */ }
}
</script>

<template><section class="nasq-page-stack"><SharedPageHeader :title="t('projects.templates.applyTitle')" :description="template?.name" :back-to="id ? templatePath(id) : returnTo" /><SharedUnsavedChanges :dirty="dirty" /><p v-if="isPending && !template" role="status" class="text-muted-foreground">{{ t('projects.loading') }}</p><p v-else-if="error || !template" role="alert" class="text-destructive">{{ t('projects.templates.notFound') }}</p><p v-else-if="!template.can_apply" class="text-muted-foreground">{{ t('projects.forbidden') }}</p><Card v-else class="nasq-form"><CardContent><form class="grid max-w-xl gap-4" @submit.prevent="apply"><p class="text-sm text-muted-foreground">{{ t('projects.templates.applyHint') }}</p><label class="grid gap-1 text-sm"><span>{{ t('projects.templates.fields.projectName') }}</span><Input v-model="name" name="project-name" :disabled="!hydrated || mutation.isPending.value" required maxlength="255" /></label><label class="grid gap-1 text-sm"><span>{{ t('projects.templates.fields.startDate') }}</span><Input v-model="startDate" name="project-start-date" :disabled="!hydrated || mutation.isPending.value" type="date" required /></label><div class="flex justify-end gap-2"><Button type="button" variant="ghost" :disabled="!hydrated || mutation.isPending.value" @click="router.push(templatePath(template.id))">{{ t('app.cancel') }}</Button><Button type="submit" :disabled="!hydrated || mutation.isPending.value">{{ mutation.isPending.value ? t('app.save') : t('projects.templates.actions.apply') }}</Button></div><p v-if="validationError" role="alert" class="text-destructive">{{ validationError }}</p><p v-if="mutation.error.value" role="alert" class="text-destructive">{{ t('projects.templates.applyError') }}</p></form></CardContent></Card></section></template>
