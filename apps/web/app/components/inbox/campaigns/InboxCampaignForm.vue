<script setup lang="ts">
import type { InboxCampaign } from '@liwan/contracts'
import { refDebounced } from '@vueuse/core'
import InboxTemplatePreview from '@/components/inbox/InboxTemplatePreview.vue'
import InboxCampaignContactPicker from '@/components/inbox/campaigns/InboxCampaignContactPicker.vue'
import InboxCampaignParamsMapper from '@/components/inbox/campaigns/InboxCampaignParamsMapper.vue'
import { inboxUploadProblem } from '@/composables/inbox/inboxAttachments'
import {
  campaignDraftSignature, campaignPreviewParts, campaignTemplates, campaignToDraft, campaignWrite, emptyCampaignDraft, headerMediaKind,
  localInputToUtc, paramRows, paramsComplete, paramsWrite, rowsFromCampaign, type CampaignDraft,
} from '@/composables/inbox/inboxCampaignParams'
import { HEADER_MEDIA_ACCEPT } from '@/composables/inbox/inboxTemplateSend'
import {
  useInboxAudienceChoices, useInboxCampaignChannels, useInboxCampaignPreview, useInboxCampaignSettings, useInboxChannelSending,
  useSaveInboxCampaign, useUploadInboxCampaignHeader,
} from '@/composables/inbox/useInboxCampaigns'
import { useInboxChannelTemplates, useInboxTemplate } from '@/composables/inbox/useInboxSettings'

// A campaign: the channel and approved template it sends, the audience, what fills each placeholder, an optional header
// file, when it starts and how fast it goes. A paused campaign changes only its name, daily cap and working-hours rule;
// everything else is fixed once it has started. The server checks every rule again on save and on launch.
const props = defineProps<{ campaign?: InboxCampaign; backTo: string }>()
const emit = defineEmits<{ saved: [campaign: InboxCampaign] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: save, isPending } = useSaveInboxCampaign()
const { mutateAsync: uploadHeader } = useUploadInboxCampaignHeader()
const channels = useInboxCampaignChannels()
const audiences = useInboxAudienceChoices()
const settings = useInboxCampaignSettings()

const limited = computed(() => props.campaign?.state === 'paused')
const draft = reactive<CampaignDraft>(props.campaign ? campaignToDraft(props.campaign, null) : emptyCampaignDraft())
const savedParams = props.campaign?.params ?? []
const headerName = ref<string | null>(props.campaign?.header_attachment?.name ?? null)
const attempted = ref(false)
const saved = ref(false)
const serverError = ref<{ field?: string; message: string } | null>(null)
const upload = reactive({ busy: false, error: '' })
const off = computed(() => !hydrated.value || isPending.value)
const locked = computed(() => off.value || limited.value)

// The default cap of a new campaign is the company's setting, applied once it has loaded and only until the admin edits it.
const capTouched = ref(false)
watch(() => settings.data.value?.default_daily_cap, (cap) => {
  if (!props.campaign && cap !== undefined && !capTouched.value) draft.dailyCap = cap
}, { immediate: true })

// ---------------------------------------------------------------- template and placeholders

const channelId = computed(() => draft.channelId)
const templatesQuery = useInboxChannelTemplates(channelId, { status: 'approved', limit: 200 })
const own = useInboxTemplate(() => props.campaign?.template?.id ?? null)
const templates = computed(() => campaignTemplates(templatesQuery.data.value?.items ?? []))
const selected = computed(() => templates.value.find(item => item.id === draft.templateId) ?? (own.data.value?.id === draft.templateId ? own.data.value : null))
const templateItems = computed(() => {
  const list = [...templates.value]
  if (own.data.value && !list.some(item => item.id === own.data.value!.id)) list.unshift(own.data.value)
  return list.map(item => ({ value: item.id, label: `${item.name} · ${item.language} · ${t(`inbox.templates.category.${item.category}`)}` }))
})
const mediaKind = computed(() => headerMediaKind(selected.value))

const baseline = ref<string | null>(props.campaign ? null : campaignDraftSignature(draft))
let seeded = !props.campaign
watch(selected, (template) => {
  const existing = !seeded ? rowsFromCampaign(template, savedParams) : draft.rows
  draft.rows = paramRows(template, existing)
  if (template) seeded = true
  if (baseline.value === null && (template || !props.campaign?.template)) baseline.value = campaignDraftSignature(draft)
}, { immediate: true })

watch(() => draft.channelId, (_, before) => {
  if (before === null || before === undefined) return
  draft.templateId = null
  draft.headerAttachmentId = null
  headerName.value = null
})
watch(() => draft.templateId, (_, before) => {
  if (!before) return
  draft.headerAttachmentId = null
  headerName.value = null
})

const dirty = computed(() => !saved.value && baseline.value !== null && campaignDraftSignature(draft) !== baseline.value)
const channelItems = computed(() => (channels.data.value?.items ?? []).map(item => ({ value: item.id, label: item.name })))
const audienceItems = computed(() => (audiences.data.value?.items ?? []).map(item => ({ value: item.id, label: `${item.name} · ${t('inbox.campaigns.audiences.reachableOf', { reachable: item.reachable_count, total: item.contact_count })}` })))
const audience = computed(() => audiences.data.value?.items.find(item => item.id === draft.audienceId) ?? null)

// ---------------------------------------------------------------- header file

async function onHeaderPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  upload.error = ''
  const problem = inboxUploadProblem(file)
  if (problem) {
    upload.error = t(`inbox.composer.upload.${problem.reason}`, { name: file.name, limit: problem.reason === 'tooLarge' ? problem.limitMb : 0 })
    return
  }
  upload.busy = true
  try {
    const attachment = await uploadHeader(file)
    draft.headerAttachmentId = attachment.id
    headerName.value = attachment.name
  } catch (e) {
    upload.error = e instanceof Error ? e.message : t('inbox.composer.upload.failed')
  } finally {
    upload.busy = false
  }
}

// ---------------------------------------------------------------- preview

const sampleContactId = ref<number | null>(null)
const previewRequest = computed(() => selected.value
  ? {
      template_id: selected.value.id,
      params: paramsWrite(draft.rows.filter(row => row.source !== 'static' || row.value.trim())),
      ...(sampleContactId.value ? { contact_id: sampleContactId.value } : {}),
    }
  : null)
const settledRequest = refDebounced(previewRequest, 300)
const preview = useInboxCampaignPreview(settledRequest)
const previewParts = computed(() => selected.value && preview.data.value ? campaignPreviewParts(selected.value, preview.data.value, headerName.value) : null)
const missingCount = computed(() => preview.data.value?.missing.length ?? 0)

const sending = useInboxChannelSending(channelId)
const marketing = computed(() => selected.value?.category === 'marketing')

// ---------------------------------------------------------------- schedule

const scheduleItems = computed(() => (['now', 'at'] as const).map(value => ({ value, label: t(`inbox.campaigns.form.schedule.${value}`) })))
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone

// ---------------------------------------------------------------- submit

const fieldError = (field: string) => serverError.value?.field === field ? serverError.value.message : undefined
const need = (missing: boolean, key: string) => attempted.value && missing ? t(key) : undefined
const nameError = computed(() => need(!draft.name.trim(), 'inbox.settings.requiredName'))
const channelError = computed(() => need(!draft.channelId, 'inbox.campaigns.form.channelRequired'))
const templateError = computed(() => need(!!draft.channelId && !draft.templateId, 'inbox.campaigns.form.templateRequired'))
const audienceError = computed(() => need(!draft.audienceId, 'inbox.campaigns.form.audienceRequired'))
const headerError = computed(() => need(!!mediaKind.value && !draft.headerAttachmentId, 'inbox.campaigns.form.headerRequired'))
const scheduleError = computed(() => need(draft.scheduleMode === 'at' && !localInputToUtc(draft.scheduledLocal), 'inbox.campaigns.form.scheduleRequired'))

async function submit() {
  attempted.value = true
  serverError.value = null
  if (off.value) return
  const body = limited.value
    ? { name: draft.name.trim(), send_within_hours: draft.sendWithinHours, daily_cap: Math.max(0, Math.round(draft.dailyCap || 0)) }
    : campaignWrite(draft)
  if (!body || (!limited.value && (headerError.value || !paramsComplete(draft.rows))) || !draft.name.trim()) return
  try {
    const campaign = await save({ id: props.campaign?.id, body })
    saved.value = true
    toast.add({ title: t('inbox.settings.saved'), color: 'success' })
    emit('saved', campaign)
  } catch (e) {
    const field = (e as { field?: string }).field
    serverError.value = { field, message: e instanceof Error ? e.message : t('errors.generic') }
    toast.add({ title: serverError.value.message, color: 'error' })
  }
}
</script>

<template>
  <!-- Drawn after hydration only: the template rows, the preview and the local time zone come from query data and the browser, which the server render does not have. -->
  <SharedLoadingSkeleton v-if="!hydrated" />
  <form v-else class="flex flex-col gap-5" novalidate data-testid="inbox-campaign-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="limited" color="info" variant="subtle" icon="i-lucide-info" :title="t('inbox.campaigns.form.limited')" data-testid="inbox-campaign-limited" />

    <UFormField :label="t('inbox.settings.name')" required :error="nameError ?? fieldError('name')">
      <UInput v-model="draft.name" class="w-full" maxlength="128" :disabled="off" data-testid="inbox-campaign-name" />
    </UFormField>

    <SharedSubCard class="flex flex-col gap-3">
      <h3 class="text-sm font-semibold text-highlighted">{{ t('inbox.campaigns.form.messageTitle') }}</h3>
      <UFormField :label="t('inbox.campaigns.form.channel')" required :error="channelError ?? fieldError('channel_id')">
        <USelect :model-value="draft.channelId ?? undefined" @update:model-value="draft.channelId = $event as number" :items="channelItems" class="w-full" :disabled="locked" :placeholder="t('inbox.campaigns.form.channelPlaceholder')" data-testid="inbox-campaign-channel" />
      </UFormField>
      <UFormField :label="t('inbox.campaigns.form.template')" :description="t('inbox.campaigns.form.templateHint')" required :error="templateError ?? fieldError('template_id')">
        <USelect :model-value="draft.templateId ?? undefined" @update:model-value="draft.templateId = $event as number" :items="templateItems" class="w-full" :disabled="locked || !draft.channelId" :loading="templatesQuery.isFetching.value" :placeholder="t('inbox.campaigns.form.templatePlaceholder')" data-testid="inbox-campaign-template" />
      </UFormField>
      <p v-if="draft.channelId && !templatesQuery.isFetching.value && !templateItems.length" class="text-sm text-muted" data-testid="inbox-campaign-no-templates">{{ t('inbox.campaigns.form.noTemplates') }}</p>
      <UFormField :label="t('inbox.campaigns.form.audience')" required :error="audienceError ?? fieldError('audience_id')">
        <USelect :model-value="draft.audienceId ?? undefined" @update:model-value="draft.audienceId = $event as number" :items="audienceItems" class="w-full" :disabled="locked" :placeholder="t('inbox.campaigns.form.audiencePlaceholder')" data-testid="inbox-campaign-audience" />
      </UFormField>
      <p v-if="audience" class="text-sm text-muted" data-testid="inbox-campaign-reach">{{ t('inbox.campaigns.form.reach', { reachable: audience.reachable_count, total: audience.contact_count }) }}</p>
    </SharedSubCard>

    <SharedSubCard v-if="selected" class="flex flex-col gap-3">
      <h3 class="text-sm font-semibold text-highlighted">{{ t('inbox.campaigns.params.title') }}</h3>
      <p class="text-sm text-muted">{{ t('inbox.campaigns.params.hint') }}</p>
      <InboxCampaignParamsMapper v-model="draft.rows" :disabled="locked" :invalid="attempted" />
      <p v-if="fieldError('params')" class="text-sm text-error" role="alert">{{ fieldError('params') }}</p>
    </SharedSubCard>

    <SharedSubCard v-if="mediaKind" class="flex flex-col gap-2">
      <h3 class="text-sm font-semibold text-highlighted">{{ t('inbox.campaigns.form.headerTitle', { kind: t(`inbox.templates.header.${mediaKind}`) }) }}</h3>
      <p class="text-sm text-muted">{{ t('inbox.campaigns.form.headerHint') }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <SharedFileField :accept="HEADER_MEDIA_ACCEPT[mediaKind]" :label="t('inbox.campaigns.form.headerUpload')" :show-file-name="false" :disabled="locked || upload.busy" data-testid="inbox-campaign-header" @change="onHeaderPicked" />
        <span v-if="upload.busy" class="inline-flex items-center gap-1 text-xs text-muted" role="status"><UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" aria-hidden="true" />{{ t('inbox.composer.uploading') }}</span>
        <span v-else-if="headerName" class="inline-flex min-w-0 items-center gap-1.5 text-sm" data-testid="inbox-campaign-header-name"><UIcon name="i-lucide-paperclip" class="size-4 shrink-0 text-muted" aria-hidden="true" /><bdi class="truncate">{{ headerName }}</bdi></span>
      </div>
      <p v-if="upload.error" class="text-sm text-error" role="alert">{{ upload.error }}</p>
      <p v-else-if="headerError ?? fieldError('header_attachment_id')" class="text-sm text-error" role="alert">{{ headerError ?? fieldError('header_attachment_id') }}</p>
    </SharedSubCard>

    <SharedSubCard class="flex flex-col gap-3">
      <h3 class="text-sm font-semibold text-highlighted">{{ t('inbox.campaigns.form.sendTitle') }}</h3>
      <UFormField :label="t('inbox.campaigns.form.scheduleLabel')" :error="scheduleError ?? fieldError('scheduled_at')">
        <SharedSegmentedControl v-model="draft.scheduleMode" :items="scheduleItems" :label="t('inbox.campaigns.form.scheduleLabel')" :disabled="locked" />
      </UFormField>
      <UFormField v-if="draft.scheduleMode === 'at'" :label="t('inbox.campaigns.form.scheduledAt')" :description="t('inbox.campaigns.form.scheduledAtHint', { zone: localZone })" required>
        <UInput v-model="draft.scheduledLocal" type="datetime-local" class="w-full sm:w-64" dir="ltr" :disabled="locked" data-testid="inbox-campaign-scheduled" />
      </UFormField>
      <label class="flex items-start gap-3 text-sm">
        <USwitch v-model="draft.sendWithinHours" class="mt-0.5" :disabled="off" data-testid="inbox-campaign-hours" />
        <span><span class="block font-medium text-highlighted">{{ t('inbox.campaigns.form.withinHours') }}</span><span class="block text-xs text-muted">{{ t('inbox.campaigns.form.withinHoursHint') }}</span></span>
      </label>
      <UFormField :label="t('inbox.campaigns.form.dailyCap')" :description="t('inbox.campaigns.form.dailyCapHint')" :error="fieldError('daily_cap')">
        <UInputNumber v-model="draft.dailyCap" class="w-full sm:w-60" :min="0" :max="1000000" :disabled="off" data-testid="inbox-campaign-cap" @update:model-value="capTouched = true" />
      </UFormField>
    </SharedSubCard>

    <SharedSubCard v-if="selected" class="flex flex-col gap-3" data-testid="inbox-campaign-preview">
      <h3 class="text-sm font-semibold text-highlighted">{{ t('inbox.campaigns.form.previewTitle') }}</h3>
      <UFormField :label="t('inbox.campaigns.form.sample')" :description="t('inbox.campaigns.form.sampleHint')">
        <InboxCampaignContactPicker v-model="sampleContactId" :audience-id="draft.audienceId" :disabled="off" :placeholder="t('inbox.campaigns.form.samplePlaceholder')" :label="t('inbox.campaigns.form.sample')" />
      </UFormField>
      <InboxTemplatePreview v-if="previewParts" :parts="previewParts" />
      <SharedLoadingSkeleton v-else-if="preview.isFetching.value" />
      <p v-if="missingCount" class="text-sm text-warning" role="status" data-testid="inbox-campaign-preview-missing">{{ t('inbox.campaigns.form.previewMissing', { count: missingCount }) }}</p>
    </SharedSubCard>

    <ul v-if="selected" class="flex flex-col gap-1 text-xs text-muted" data-testid="inbox-campaign-hints">
      <li v-if="marketing">{{ t('inbox.campaigns.hints.charged') }}</li>
      <li v-if="marketing">{{ t('inbox.campaigns.hints.us') }}</li>
      <li v-if="sending.data.value">{{ sending.data.value.remaining_24h === null ? t('inbox.campaigns.hints.unlimited') : t('inbox.campaigns.hints.remaining', { remaining: sending.data.value.remaining_24h, limit: t(`inbox.health.limit.${sending.data.value.messaging_limit}`) }) }}</li>
    </ul>

    <div class="flex justify-end gap-2">
      <UButton :to="props.backTo" color="neutral" variant="outline" :disabled="off" :label="t('app.cancel')" />
      <UButton type="submit" :disabled="off || upload.busy" :loading="isPending" :label="props.campaign ? t('app.save') : t('inbox.campaigns.create')" data-testid="inbox-campaign-submit" />
    </div>
  </form>
</template>
