<script setup lang="ts">
import type { InboxTemplate } from '@webvue/contracts'
import type { RouteLocationRaw } from 'vue-router'
import {
  HEADER_KINDS,
  TEMPLATE_CATEGORIES, TEMPLATE_LANGUAGES, TEMPLATE_LIMITS,
  addTemplateVariable, draftFromTemplate, draftPreview, emptyTemplateDraft, finalTemplateName, resizeExamples, slugifyTemplateName,
  templatePlaceholderCount, templateWriteCandidate, validateTemplateDraft,
} from '@/composables/inbox/inboxTemplate'
import { HEADER_MEDIA_ACCEPT } from '@/composables/inbox/inboxTemplateSend'
import { inboxUploadProblem } from '@/composables/inbox/inboxAttachments'
import { useSaveInboxTemplate, useUploadInboxTemplateSample } from '@/composables/inbox/useInboxSettings'

// The template builder: category, name, language, header, body with variables and their examples, footer and buttons,
// beside a live preview. An authentication template only chooses Meta's options around its fixed text. Meta reviews the
// template after it is saved, so an invalid draft never leaves the browser (the contract's write schema decides) and a
// refusal from Meta is shown here with its own words.
// `sideBySide` puts the preview beside the fields (a full page); in a narrow panel it comes first, above them.
const props = defineProps<{ channelId: number; template?: InboxTemplate; readonly?: boolean; backTo: RouteLocationRaw; sideBySide?: boolean }>()
const emit = defineEmits<{ saved: [template: InboxTemplate] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const editing = computed(() => !!props.template)
const { mutateAsync: save, isPending } = useSaveInboxTemplate(() => props.channelId)
const { mutateAsync: uploadSample } = useUploadInboxTemplateSample(() => props.channelId)

const draft = reactive(props.template ? draftFromTemplate(props.template, t('inbox.templates.auth.copyCode')) : emptyTemplateDraft(t('inbox.templates.auth.copyCode')))
const initial = JSON.stringify(templateWriteCandidate(draft))
const attempted = ref(false)
const saved = ref(false)
const serverError = ref<{ field?: string; message: string } | null>(null)
const sampleState = reactive({ uploading: false, error: '' })
const off = computed(() => !hydrated.value || isPending.value || !!props.readonly)

const standard = computed(() => draft.category !== 'authentication')
const dirty = computed(() => !props.readonly && !saved.value && JSON.stringify(templateWriteCandidate(draft)) !== initial)
const validation = computed(() => validateTemplateDraft(draft))
const invalidFields = computed(() => validation.value.ok ? new Set<string>() : validation.value.fields)
function fieldError(field: string) {
  if (serverError.value?.field === field) return serverError.value.message
  return attempted.value && invalidFields.value.has(field) ? t(`inbox.templates.invalid.${field}`) : undefined
}

const categoryItems = computed(() => TEMPLATE_CATEGORIES.map(value => ({ value, label: t(`inbox.templates.category.${value}`) })))
const languageItems = computed(() => {
  const names = (() => {
    try { return new Intl.DisplayNames([locale.value], { type: 'language' }) } catch { return null }
  })()
  return TEMPLATE_LANGUAGES.map((code) => {
    const name = names?.of(code.replace('_', '-'))
    return { value: code, label: name && name !== code ? `${name} (${code})` : code }
  })
})
const headerItems = computed(() => HEADER_KINDS.map(value => ({ value, label: t(`inbox.templates.header.${value}`) })))
// Meta takes a category change on an unapproved template only.
const categoryLocked = computed(() => editing.value && props.template?.status === 'approved')

const bodyCount = computed(() => templatePlaceholderCount(draft.body))
const headerVariable = computed(() => templatePlaceholderCount(draft.headerText) >= 1)
watch(bodyCount, count => { draft.bodyExamples = resizeExamples(draft.bodyExamples, count) })
watch(() => draft.headerKind, () => { draft.headerSample = null; sampleState.error = '' })

function onName(value: string | number) {
  draft.name = slugifyTemplateName(String(value))
}
function onNameBlur() {
  draft.name = finalTemplateName(draft.name)
}
function addBodyVariable() {
  if (bodyCount.value < 20) draft.body = addTemplateVariable(draft.body)
}
function addHeaderVariable() {
  if (!headerVariable.value) draft.headerText = addTemplateVariable(draft.headerText)
}

async function onSamplePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  sampleState.error = ''
  const problem = inboxUploadProblem(file)
  if (problem) {
    sampleState.error = t(`inbox.composer.upload.${problem.reason}`, { name: file.name, limit: problem.reason === 'tooLarge' ? problem.limitMb : 0 })
    return
  }
  sampleState.uploading = true
  try {
    draft.headerSample = await uploadSample(file)
  } catch (e) {
    sampleState.error = e instanceof Error ? e.message : t('inbox.composer.upload.failed')
  } finally {
    sampleState.uploading = false
  }
}

const preview = computed(() => draftPreview(draft, {
  body: t('inbox.templates.auth.previewBody'),
  security: t('inbox.templates.auth.previewSecurity'),
  expiry: minutes => t('inbox.templates.auth.previewExpiry', { minutes }),
  copyCode: t('inbox.templates.auth.copyCode'),
}))
const mediaKind = computed(() => draft.headerKind === 'image' || draft.headerKind === 'video' || draft.headerKind === 'document' ? draft.headerKind : null)

// The server names the sample file by its request field; the form shows it on the header.
const serverField = (field?: string) => field === 'example_attachment_id' ? 'header' : field

async function submit() {
  attempted.value = true
  serverError.value = null
  const result = validation.value
  if (!hydrated.value || isPending.value || props.readonly || !result.ok) return
  try {
    const template = await save({ id: props.template?.id, body: result.data })
    saved.value = true
    emit('saved', template)
  } catch (e) {
    serverError.value = { field: serverField((e as { field?: string }).field), message: e instanceof Error ? e.message : t('errors.generic') }
  }
}
defineExpose({ draft })
</script>

<template>
  <form class="grid gap-6" :class="{ 'lg:grid-cols-[minmax(0,1fr)_20rem]': props.sideBySide }" novalidate data-testid="inbox-template-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <div class="min-w-0 space-y-6" :class="{ 'order-2': !props.sideBySide }">
      <UAlert v-if="serverError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('inbox.templates.serverError')" :description="serverError.message" data-testid="inbox-template-server-error" />
      <UAlert v-if="props.readonly && props.template" color="info" variant="subtle" icon="i-lucide-lock" :title="t('inbox.templates.readonlyTitle')" :description="props.template.supported ? t('inbox.templates.readonlyDescription') : t('inbox.templates.unsupportedDescription')" data-testid="inbox-template-readonly" />

      <SharedFormSection panel :title="t('inbox.templates.form.identity')" :description="t('inbox.templates.form.identityHint')">
        <div class="grid gap-4">
          <UFormField name="category" :label="t('inbox.templates.form.category')" :description="t(`inbox.templates.categoryHint.${draft.category}`)">
            <SharedSegmentedControl v-model="draft.category" :items="categoryItems" :label="t('inbox.templates.form.category')" :disabled="off || categoryLocked" />
          </UFormField>
          <UFormField name="name" :label="t('inbox.templates.form.name')" :description="t('inbox.templates.form.nameHint')" required :error="fieldError('name')">
            <UInput :model-value="draft.name" class="w-full" dir="ltr" autocomplete="off" :disabled="off || editing" data-testid="inbox-template-name" @update:model-value="onName" @blur="onNameBlur" />
          </UFormField>
          <UFormField name="language" :label="t('inbox.templates.form.language')" required :error="fieldError('language')">
            <USelect v-model="draft.language" :items="languageItems" class="w-full" :disabled="off || editing" data-testid="inbox-template-language" />
          </UFormField>
          <UCheckbox v-if="standard" v-model="draft.allowCategoryChange" :label="t('inbox.templates.form.allowCategoryChange')" :description="t('inbox.templates.form.allowCategoryChangeHint')" :disabled="off" />
        </div>
      </SharedFormSection>

      <template v-if="standard">
        <SharedFormSection panel :title="t('inbox.templates.form.headerTitle')" :description="t('inbox.templates.form.headerHint')">
          <div class="grid gap-4">
            <UFormField name="headerKind" :label="t('inbox.templates.form.headerType')">
              <USelect v-model="draft.headerKind" :items="headerItems" class="w-full" :disabled="off" data-testid="inbox-template-header-type" />
            </UFormField>
            <template v-if="draft.headerKind === 'text'">
              <UFormField name="header" :label="t('inbox.templates.form.headerText')" required :error="fieldError('header')">
                <div class="flex gap-2">
                  <UInput v-model="draft.headerText" class="min-w-0 flex-1" :maxlength="TEMPLATE_LIMITS.headerText" :disabled="off" data-testid="inbox-template-header-text" />
                  <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :label="t('inbox.templates.form.addVariable')" :disabled="off || headerVariable" @click="addHeaderVariable" />
                </div>
                <template #hint><span class="text-xs text-muted">{{ draft.headerText.length }}/{{ TEMPLATE_LIMITS.headerText }}</span></template>
              </UFormField>
              <UFormField v-if="headerVariable" :label="t('inbox.templates.form.variableExample', { n: 1 })" required>
                <UInput v-model="draft.headerExample" class="w-full" :maxlength="TEMPLATE_LIMITS.headerText" :disabled="off" data-testid="inbox-template-header-example" />
              </UFormField>
            </template>
            <template v-else-if="mediaKind">
              <p class="text-sm text-muted">{{ t('inbox.templates.form.sampleHint') }}</p>
              <div class="flex flex-wrap items-center gap-2">
                <SharedFileField :accept="HEADER_MEDIA_ACCEPT[mediaKind]" :label="t('inbox.templates.form.sampleUpload')" :show-file-name="false" :disabled="off || sampleState.uploading" data-testid="inbox-template-sample" @change="onSamplePicked" />
                <span v-if="sampleState.uploading" class="inline-flex items-center gap-1 text-xs text-muted" role="status"><UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" aria-hidden="true" />{{ t('inbox.composer.uploading') }}</span>
                <span v-else-if="draft.headerSample" class="inline-flex min-w-0 items-center gap-1.5 text-sm" data-testid="inbox-template-sample-name"><UIcon name="i-lucide-paperclip" class="size-4 shrink-0 text-muted" aria-hidden="true" /><bdi class="truncate">{{ draft.headerSample.name }}</bdi></span>
              </div>
              <p v-if="sampleState.error" class="text-sm text-error" role="alert" data-testid="inbox-template-sample-error">{{ sampleState.error }}</p>
              <p v-else-if="attempted && invalidFields.has('header')" class="text-sm text-error" role="alert">{{ t('inbox.templates.invalid.sample') }}</p>
            </template>
            <p v-else-if="draft.headerKind === 'location'" class="text-sm text-muted">{{ t('inbox.templates.form.locationHint') }}</p>
          </div>
        </SharedFormSection>

        <SharedFormSection panel :title="t('inbox.templates.form.bodyTitle')" :description="t('inbox.templates.form.bodyHint')">
          <div class="grid gap-4">
            <UFormField name="body" :label="t('inbox.templates.form.body')" required :error="fieldError('body')">
              <UTextarea v-model="draft.body" :rows="5" autoresize class="w-full" :maxlength="TEMPLATE_LIMITS.body" :disabled="off" data-testid="inbox-template-body" />
              <template #hint><span class="text-xs text-muted" data-testid="inbox-template-body-count">{{ draft.body.length }}/{{ TEMPLATE_LIMITS.body }}</span></template>
            </UFormField>
            <div>
              <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :label="t('inbox.templates.form.addVariable')" :disabled="off || bodyCount >= 20" data-testid="inbox-template-add-variable" @click="addBodyVariable" />
            </div>
            <div v-if="bodyCount" class="grid gap-3" data-testid="inbox-template-examples">
              <p class="text-sm text-muted">{{ t('inbox.templates.form.examplesHint') }}</p>
              <UFormField v-for="(_, index) in draft.bodyExamples" :key="index" :label="t('inbox.templates.form.variableExample', { n: index + 1 })" required :error="attempted && !draft.bodyExamples[index]?.trim() ? t('inbox.templates.invalid.body_examples') : undefined">
                <UInput v-model="draft.bodyExamples[index]" class="w-full" :maxlength="TEMPLATE_LIMITS.example" :disabled="off" :data-testid="`inbox-template-example-${index}`" />
              </UFormField>
            </div>
          </div>
        </SharedFormSection>

        <SharedFormSection panel :title="t('inbox.templates.form.footerTitle')" :description="t('inbox.templates.form.footerHint')">
          <UFormField name="footer" :label="t('inbox.templates.form.footer')" :error="fieldError('footer')">
            <UInput v-model="draft.footer" class="w-full" :maxlength="TEMPLATE_LIMITS.footer" :disabled="off" data-testid="inbox-template-footer" />
            <template #hint><span class="text-xs text-muted">{{ draft.footer.length }}/{{ TEMPLATE_LIMITS.footer }}</span></template>
          </UFormField>
        </SharedFormSection>

        <SharedFormSection panel :title="t('inbox.templates.form.buttonsTitle')" :description="t('inbox.templates.form.buttonsHint')">
          <InboxTemplateButtonsEditor v-model="draft.buttons" :disabled="off" />
          <p v-if="fieldError('buttons')" class="mt-2 text-sm text-error" role="alert">{{ fieldError('buttons') }}</p>
        </SharedFormSection>
      </template>

      <SharedFormSection v-else panel :title="t('inbox.templates.auth.title')" :description="t('inbox.templates.auth.hint')">
        <div class="grid gap-4">
          <UCheckbox v-model="draft.addSecurityRecommendation" :label="t('inbox.templates.auth.securityRecommendation')" :description="t('inbox.templates.auth.securityRecommendationHint')" :disabled="off" data-testid="inbox-template-security" />
          <UFormField name="code_expiration_minutes" :label="t('inbox.templates.auth.expiration')" :description="t('inbox.templates.auth.expirationHint', { max: TEMPLATE_LIMITS.expirationMinutes })" :error="fieldError('code_expiration_minutes')">
            <UInput v-model="draft.codeExpirationMinutes" class="w-full" type="number" inputmode="numeric" min="1" :max="TEMPLATE_LIMITS.expirationMinutes" :disabled="off" data-testid="inbox-template-expiration" />
          </UFormField>
          <UFormField name="otp_button_text" :label="t('inbox.templates.auth.buttonText')" required :error="fieldError('otp_button_text')">
            <UInput v-model="draft.otpButtonText" class="w-full" :maxlength="TEMPLATE_LIMITS.buttonText" :disabled="off" data-testid="inbox-template-otp-text" />
          </UFormField>
        </div>
      </SharedFormSection>

      <SharedFormActions v-if="!props.readonly">
        <div class="ms-auto flex flex-wrap gap-2">
          <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :disabled="!hydrated || isPending" :label="t('app.cancel')" />
          <UButton type="submit" :disabled="!hydrated || (editing && !dirty)" :loading="isPending" :label="editing ? t('inbox.templates.form.saveChanges') : t('inbox.templates.form.submit')" data-testid="inbox-template-submit" />
        </div>
      </SharedFormActions>
    </div>

    <aside class="min-w-0" :class="props.sideBySide ? 'order-2 lg:sticky lg:top-4 lg:self-start' : 'order-1'" :aria-label="t('inbox.templates.preview.title')">
      <SharedSubCard class="flex flex-col gap-3">
        <h2 class="text-sm font-semibold text-highlighted">{{ t('inbox.templates.preview.title') }}</h2>
        <InboxTemplatePreview :parts="preview" />
        <p class="text-xs text-muted">{{ t('inbox.templates.preview.hint') }}</p>
      </SharedSubCard>
    </aside>
  </form>
</template>
