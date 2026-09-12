<script setup lang="ts">
import { useApplyProjectTemplate, useProjectTemplate, useProjectTemplateNavigation } from '@/composables/useProjectTemplates'
import { ProjectTemplateApplySchema } from '@nasq/contracts'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'

const route = useRoute(); const router = useRouter(); const { t } = useI18n(); const toast = useToast(); const hydrated = useHydrated()
const id = computed(() => { const value = Number(route.params.id); return Number.isInteger(value) && value > 0 ? value : null })
const { data: template, isLoading, error, refetch } = useProjectTemplate(id); const mutation = useApplyProjectTemplate()
const { backTo: listTo, templatePath } = useProjectTemplateNavigation()
// An edit or apply form returns to the template it acts on, not past it to the
// list; only a template with no readable id has nowhere closer to go.
const backTo = computed(() => id.value ? templatePath(id.value) : listTo.value)
const name = ref(''); const startDate = ref<string | null>(null); const saved = ref(false)
const baseline = ref(''); const initialized = ref(false); const validationError = ref('')
const serialized = () => JSON.stringify({ name: name.value, start_date: startDate.value })
const dirty = computed(() => initialized.value && !saved.value && serialized() !== baseline.value)
function seedTemplate(value: typeof template.value) {
  if (value && !initialized.value) {
    name.value = value.name
    baseline.value = serialized()
    initialized.value = true
  }
}
watch(template, seedTemplate, { immediate: true })
useSsrQuerySeed({ data: template }, seedTemplate)
async function apply() {
  if (!id.value || !hydrated.value || mutation.isPending.value || !template.value?.can_apply) return
  const parsed = ProjectTemplateApplySchema.safeParse({ name: name.value, start_date: startDate.value })
  validationError.value = parsed.success ? '' : t('projects.templates.validation.applyFields')
  if (!parsed.success) return
  try {
    const project = await mutation.mutateAsync({ id: id.value, body: parsed.data })
    saved.value = true
    await nextTick()
    toast.add({ title: t('projects.templates.applied'), color: 'success', icon: 'i-lucide-circle-check' })
    await router.push(`/projects/${project.id}`)
  } catch { /* Failed application retains inputs and dirty state. */ }
}
</script>

<template><SharedPageContainer width="form"><SharedPageHeader :title="t('projects.templates.applyTitle')" :description="template?.name" :back-to="backTo" /><SharedUnsavedChanges :dirty="dirty" /><SharedPageState :loading="isLoading && !template" :error="template ? null : error" :empty="!isLoading && !error && !template" :empty-text="t('projects.templates.notFound')" @retry="refetch"><p v-if="template && !template.can_apply" class="text-muted">{{ t('projects.forbidden') }}</p><UCard v-else-if="template" class="space-y-6"><form class="grid max-w-xl gap-4" @submit.prevent="apply"><p class="text-sm text-muted">{{ t('projects.templates.applyHint') }}</p><UFormField :label="t('projects.templates.fields.projectName')"><UInput v-model="name" name="project-name" :disabled="!hydrated || mutation.isPending.value" required maxlength="255" class="w-full" /></UFormField><UFormField :label="t('projects.templates.fields.startDate')"><SharedDateField v-model="startDate" name="project-start-date" :aria-label="t('projects.templates.fields.startDate')" :disabled="!hydrated || mutation.isPending.value" aria-required="true" class="w-full" /></UFormField><div class="flex justify-end gap-2"><UButton color="neutral" variant="outline" type="button" :disabled="!hydrated || mutation.isPending.value" @click="router.push(templatePath(template.id))">{{ t('app.cancel') }}</UButton><UButton type="submit" :disabled="!hydrated || mutation.isPending.value">{{ mutation.isPending.value ? t('app.save') : t('projects.templates.actions.apply') }}</UButton></div><p v-if="validationError" role="alert" class="text-error">{{ validationError }}</p><p v-if="mutation.error.value" role="alert" class="text-error">{{ t('projects.templates.applyError') }}</p></form></UCard></SharedPageState></SharedPageContainer></template>
