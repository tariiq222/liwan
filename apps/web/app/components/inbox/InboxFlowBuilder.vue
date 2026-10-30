<script setup lang="ts">
import type { InboxFlow } from '@liwan/contracts'
import type { RouteLocationRaw } from 'vue-router'
import InboxFlowPreview from '@/components/inbox/InboxFlowPreview.vue'
import InboxFlowScreenEditor from '@/components/inbox/InboxFlowScreenEditor.vue'
import {
  FLOW_CATEGORIES, FLOW_LIMITS, emptyScreen, flowLanguageItems, flowPreviewModel, flowToDraft, flowWriteCandidate, formProblems, moveToIndex, placeMetaErrors, validateFlowDraft,
  type FlowProblem,
} from '@/composables/inbox/inboxFlow'
import { useSaveInboxFlow } from '@/composables/inbox/useInboxFlows'

// The form builder: the form's settings, its screens with their components, and a live WhatsApp-like preview beside
// them. Every save replaces the whole draft on the server and in Meta; the contract's write schema decides what may be
// sent, so an invalid draft never leaves the browser, and what Meta finds wrong comes back inline on the field. A form
// that is no longer a draft (published, deprecated) or that LiwanOS cannot read is shown read-only: copy it to change it.
const props = defineProps<{ flow: InboxFlow; readonly?: boolean; backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [flow: InboxFlow] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: save, isPending } = useSaveInboxFlow(() => props.flow.channel.id)

const draft = reactive(flowToDraft(props.flow))
const baseline = ref(JSON.stringify(flowWriteCandidate(draft)))
const dirty = computed(() => !props.readonly && JSON.stringify(flowWriteCandidate(draft)) !== baseline.value)
const attempted = ref(false)
const serverError = ref<{ field?: string; message: string; status?: number } | null>(null)
const off = computed(() => !hydrated.value || isPending.value || !!props.readonly)
const activeScreen = ref(0)

const validation = computed(() => validateFlowDraft(draft))
const problems = computed<FlowProblem[]>(() => attempted.value && !validation.value.ok ? validation.value.problems : [])
const own = computed(() => formProblems(problems.value))
const flagged = (prop: string) => own.value.some(problem => problem.prop === prop)
const spanning = computed(() => own.value.filter(problem => problem.prop === null))
const meta = computed(() => placeMetaErrors(props.flow.validation_errors, draft))
const preview = computed(() => flowPreviewModel(draft))

const categoryItems = computed(() => FLOW_CATEGORIES.map(value => ({ value, label: t(`inbox.flows.category.${value}`) })))
const languageItems = computed(() => flowLanguageItems(locale.value))

function addScreen() {
  if (draft.screens.length >= FLOW_LIMITS.screens) return
  draft.screens.push(emptyScreen('', t('inbox.flows.defaults.submit')))
  activeScreen.value = draft.screens.length - 1
}
function moveScreen(index: number, step: -1 | 1) {
  draft.screens = moveToIndex(draft.screens, index, index + step)
  activeScreen.value = index + step
}
function removeScreen(index: number) {
  if (draft.screens.length <= 1) return
  draft.screens.splice(index, 1)
  activeScreen.value = Math.min(activeScreen.value, draft.screens.length - 1)
}

async function submit() {
  attempted.value = true
  serverError.value = null
  const result = validation.value
  if (!hydrated.value || isPending.value || props.readonly || !result.ok) return
  try {
    const flow = await save({ id: props.flow.id, body: result.data })
    baseline.value = JSON.stringify(flowWriteCandidate(draft))
    emit('saved', flow)
  } catch (e) {
    const error = e as { field?: string; status?: number }
    serverError.value = { field: error.field, status: error.status, message: error.status === 502 ? t('inbox.flows.metaUnreachable') : e instanceof Error ? e.message : t('errors.generic') }
  }
}
defineExpose({ draft, submit, dirty, problems, validation, serverError, addScreen, removeScreen, moveScreen, meta, activeScreen })
</script>

<template>
  <form class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]" novalidate data-testid="inbox-flow-builder" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <div class="min-w-0 space-y-6">
      <UAlert v-if="serverError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="serverError.status === 502 ? t('inbox.flows.metaUnreachableTitle') : t('inbox.flows.serverError')" :description="serverError.message" data-testid="inbox-flow-server-error" />
      <UAlert v-if="props.readonly" color="info" variant="subtle" icon="i-lucide-lock" :title="t('inbox.flows.readonlyTitle')" :description="props.flow.supported ? t('inbox.flows.readonlyDescription') : t('inbox.flows.externalDescription')" data-testid="inbox-flow-readonly" />
      <UAlert v-if="props.flow.version_warning" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('inbox.flows.versionWarning')" :description="props.flow.version_warning" data-testid="inbox-flow-version-warning" />
      <UAlert v-if="props.flow.validation_errors.length" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('inbox.flows.meta.title', { n: props.flow.validation_errors.length })" :description="t('inbox.flows.meta.hint')" data-testid="inbox-flow-meta-errors">
        <template v-if="meta.loose.length" #description>
          <p>{{ t('inbox.flows.meta.hint') }}</p>
          <ul class="mt-1 list-disc ps-5"><li v-for="(error, index) in meta.loose" :key="index" dir="auto">{{ error.message }}</li></ul>
        </template>
      </UAlert>

      <SharedFormSection panel :title="t('inbox.flows.builder.settings')" :description="t('inbox.flows.builder.settingsHint')">
        <div class="grid gap-4">
          <UFormField :label="t('inbox.flows.form.name')" :description="t('inbox.flows.form.nameHint')" required :error="flagged('name') ? t('inbox.flows.problem.invalidProp', { prop: t('inbox.flows.prop.name') }) : serverError?.field === 'name' ? serverError.message : undefined">
            <UInput v-model="draft.name" class="w-full" :maxlength="FLOW_LIMITS.name" :disabled="off" data-testid="inbox-flow-name" />
          </UFormField>
          <UFormField :label="t('inbox.flows.form.category')" :description="t('inbox.flows.form.categoryHint')">
            <USelect v-model="draft.category" :items="categoryItems" class="w-full" :disabled="off" data-testid="inbox-flow-category" />
          </UFormField>
          <UFormField :label="t('inbox.flows.form.language')" :description="t('inbox.flows.form.languageHint')" :error="flagged('language') ? t('inbox.flows.problem.invalidProp', { prop: t('inbox.flows.prop.language') }) : undefined">
            <USelect v-model="draft.language" :items="languageItems" class="w-full" :disabled="off" data-testid="inbox-flow-language" />
          </UFormField>
          <UFormField :label="t('inbox.flows.form.completion')" :description="t('inbox.flows.form.completionHint')" :error="flagged('completion_message') ? t('inbox.flows.problem.invalidProp', { prop: t('inbox.flows.prop.completion_message') }) : undefined">
            <UTextarea v-model="draft.completionMessage" class="w-full" :rows="2" autoresize :maxrows="8" :maxlength="FLOW_LIMITS.completionMessage" :disabled="off" data-testid="inbox-flow-completion" />
            <template #hint><span class="text-xs text-muted">{{ draft.completionMessage.length }}/{{ FLOW_LIMITS.completionMessage }}</span></template>
          </UFormField>
        </div>
      </SharedFormSection>

      <SharedFormSection panel :title="t('inbox.flows.builder.screens')" :description="t('inbox.flows.builder.screensHint', { max: FLOW_LIMITS.screens })">
        <ul v-if="spanning.length" class="mb-3 flex flex-col gap-0.5 text-sm text-error" role="alert" data-testid="inbox-flow-form-problems">
          <li v-for="problem in spanning" :key="problem.code">{{ t(`inbox.flows.problem.${problem.code}`) }}</li>
        </ul>
        <div class="flex flex-col gap-4">
          <InboxFlowScreenEditor
            v-for="(screen, index) in draft.screens"
            :key="screen.uid"
            v-model="draft.screens[index]!"
            :draft="draft"
            :index="index"
            :disabled="off"
            :problems="problems"
            :meta-errors="meta.placed.map(item => ({ spot: item.spot, message: item.error.message }))"
            @focus="activeScreen = index"
            @move="moveScreen(index, $event)"
            @remove="removeScreen(index)"
          />
          <UButton type="button" class="self-start" color="neutral" variant="outline" icon="i-lucide-plus" :label="t('inbox.flows.builder.addScreen')" :disabled="off || draft.screens.length >= FLOW_LIMITS.screens" data-testid="inbox-flow-add-screen" @click="addScreen" />
        </div>
      </SharedFormSection>

      <SharedFormActions v-if="!props.readonly">
        <div class="ms-auto flex flex-wrap gap-2">
          <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :disabled="!hydrated || isPending" :label="t('app.cancel')" />
          <UButton type="submit" :disabled="!hydrated || !dirty" :loading="isPending" :label="t('inbox.flows.builder.save')" data-testid="inbox-flow-save" />
        </div>
      </SharedFormActions>
    </div>

    <aside class="min-w-0 lg:sticky lg:top-4 lg:self-start" :aria-label="t('inbox.flows.preview.title')">
      <SharedSubCard class="flex flex-col gap-3">
        <h2 class="text-sm font-semibold text-highlighted">{{ t('inbox.flows.preview.title') }}</h2>
        <InboxFlowPreview v-model:screen="activeScreen" :model="preview" />
        <p class="text-xs text-muted">{{ t('inbox.flows.preview.hint') }}</p>
      </SharedSubCard>
    </aside>
  </form>
</template>
