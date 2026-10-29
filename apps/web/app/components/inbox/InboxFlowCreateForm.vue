<script setup lang="ts">
import type { InboxFlow, InboxFlowCategory } from '@webvue/contracts'
import type { RouteLocationRaw } from 'vue-router'
import {
  FLOW_CATEGORIES, FLOW_LIMITS, FLOW_STARTERS, STARTER_SPECS, blankFlowDraft, flowLanguageItems, formProblems, starterDraft, validateFlowDraft,
  type FlowDefaults, type FlowStarterKey,
} from '@/composables/inbox/inboxFlow'
import { TEMPLATE_LANGUAGES } from '@/composables/inbox/inboxTemplate'
import { useSaveInboxFlow } from '@/composables/inbox/useInboxFlows'

// Creates a form as a draft: a name, a category and a language, starting from a blank form or a sector starter (a clinic
// appointment request, a store order inquiry, a public service request). The draft is stored in WebVue and Meta, never
// published here; the builder opens next to edit it.
const props = defineProps<{ channelId: number; backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [flow: InboxFlow] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: save, isPending } = useSaveInboxFlow(() => props.channelId)

const BLANK = 'blank'
const start = ref<string>(BLANK)
const name = ref('')
const category = ref<InboxFlowCategory>('lead_generation')
const language = ref(TEMPLATE_LANGUAGES.includes(locale.value) ? locale.value : 'ar')
const attempted = ref(false)
const serverError = ref<{ field?: string; message: string } | null>(null)
const off = computed(() => !hydrated.value || isPending.value)

const defaults = computed<FlowDefaults>(() => ({
  screenTitle: t('inbox.flows.defaults.screenTitle'), fieldLabel: t('inbox.flows.defaults.fieldLabel'),
  footerNext: t('inbox.flows.defaults.next'), footerSubmit: t('inbox.flows.defaults.submit'),
}))
const startItems = computed(() => [
  { value: BLANK, label: t('inbox.flows.form.blank') },
  ...FLOW_STARTERS.map(value => ({ value, label: t(`inbox.flows.starters.${value}.name`) })),
])
const categoryItems = computed(() => FLOW_CATEGORIES.map(value => ({ value, label: t(`inbox.flows.category.${value}`) })))
const languageItems = computed(() => flowLanguageItems(locale.value))

// A starter suggests its own name and category; the user may change both.
watch(start, (value) => {
  if (value === BLANK) return
  const key = value as FlowStarterKey
  name.value = t(`inbox.flows.starters.${key}.name`)
  category.value = STARTER_SPECS[key].category
})

function build() {
  const draft = start.value === BLANK ? blankFlowDraft(defaults.value, language.value) : starterDraft(start.value as FlowStarterKey, defaults.value, key => t(key), language.value)
  return { ...draft, name: name.value.trim(), category: category.value, language: language.value }
}
const validation = computed(() => validateFlowDraft(build()))
const problems = computed(() => attempted.value && !validation.value.ok ? formProblems(validation.value.problems) : [])
const flagged = (prop: string) => problems.value.some(problem => problem.prop === prop)

async function submit() {
  attempted.value = true
  serverError.value = null
  const result = validation.value
  if (off.value || !result.ok) return
  try {
    emit('saved', await save({ body: result.data }))
  } catch (e) {
    const error = e as { field?: string; status?: number }
    serverError.value = { field: error.field, message: error.status === 502 ? t('inbox.flows.metaUnreachable') : e instanceof Error ? e.message : t('errors.generic') }
  }
}
defineExpose({ start, name, category, language, submit, build, serverError })
</script>

<template>
  <form class="flex flex-col gap-4" novalidate data-testid="inbox-flow-create-form" @submit.prevent="submit">
    <UAlert v-if="serverError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('inbox.flows.serverError')" :description="serverError.message" data-testid="inbox-flow-server-error" />
    <UFormField :label="t('inbox.flows.form.startFrom')" :description="t('inbox.flows.form.startFromHint')">
      <USelect v-model="start" :items="startItems" class="w-full" :disabled="off" data-testid="inbox-flow-start" />
    </UFormField>
    <UFormField :label="t('inbox.flows.form.name')" :description="t('inbox.flows.form.nameHint')" required :error="flagged('name') ? t('inbox.flows.problem.invalidProp', { prop: t('inbox.flows.prop.name') }) : serverError?.field === 'name' ? serverError.message : undefined">
      <UInput v-model="name" class="w-full" :maxlength="FLOW_LIMITS.name" :disabled="off" data-testid="inbox-flow-name" />
    </UFormField>
    <UFormField :label="t('inbox.flows.form.category')" :description="t('inbox.flows.form.categoryHint')">
      <USelect v-model="category" :items="categoryItems" class="w-full" :disabled="off" data-testid="inbox-flow-category" />
    </UFormField>
    <UFormField :label="t('inbox.flows.form.language')" :description="t('inbox.flows.form.languageHint')">
      <USelect v-model="language" :items="languageItems" class="w-full" :disabled="off" data-testid="inbox-flow-language" />
    </UFormField>
    <SharedFormActions>
      <div class="ms-auto flex flex-wrap gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :disabled="!hydrated || isPending" :label="t('app.cancel')" />
        <UButton type="submit" :disabled="!hydrated" :loading="isPending" :label="t('inbox.flows.form.create')" data-testid="inbox-flow-submit" />
      </div>
    </SharedFormActions>
  </form>
</template>
