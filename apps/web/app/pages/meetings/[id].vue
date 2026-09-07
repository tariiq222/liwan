<script setup lang="ts">
import { Paperclip, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import {
  useConvertResolution,
  useDeleteMeetingAttachment,
  useMeeting,
  useMeetingAttachments,
  useUploadMeetingAttachment,
} from '@/composables/useMeetings'
import { useProjects } from '@/composables/useProjects'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const isDetail = computed(() => route.path === `/meetings/${id.value}`)
const query = useMeeting(computed(() => isDetail.value ? id.value : null))
const attachments = useMeetingAttachments(computed(() => isDetail.value ? id.value : null))
const { data: projects } = useProjects()
const { mutateAsync: upload, isPending: uploading } = useUploadMeetingAttachment()
const { mutateAsync: remove, isPending: deleting } = useDeleteMeetingAttachment()
const { mutateAsync: convert, isPending: converting } = useConvertResolution()
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/meetings', ['/meetings']))
const projectByResolution = ref<Record<number, number>>({})
const pendingDeleteId = ref<number | null>(null)

function localTime(value: string | null) {
  return value ? value.replace('T', ' ').replace('Z', '') : ''
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !id.value) return
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = String(reader.result ?? '')
        resolve(result.slice(result.indexOf(',') + 1))
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    await upload({ meetingId: id.value, name: file.name, mimetype: file.type || undefined, data })
  } catch (error) {
    toast.error(error instanceof ApiError || error instanceof Error ? error.message : t('errors.generic'))
  } finally {
    input.value = ''
  }
}

async function confirmDelete(attachmentId: number) {
  if (!id.value) return
  try {
    await remove({ meetingId: id.value, attachmentId })
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
  } finally {
    pendingDeleteId.value = null
  }
}

async function convertResolution(resolutionId: number) {
  const projectId = projectByResolution.value[resolutionId]
  if (!projectId || !id.value) return
  const task = await convert({ meetingId: id.value, resolutionId, projectId })
  await navigateTo(`/tasks/${task.id}`)
}
</script>

<template>
  <SharedPageContainer v-if="isDetail" width="detail">
    <SharedPageHeader :title="query.data.value?.name || t('nav.meetings')" :back-to="backTo">
      <NuxtLink v-if="query.data.value?.can_edit" :to="{ path: `/meetings/${id}/edit`, query: returnToQuery(route.fullPath) }">
        <Button>{{ t('app.edit') }}</Button>
      </NuxtLink>
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <div v-if="query.data.value" class="grid gap-4">
        <section class="nasq-panel nasq-panel-body">
          <dl class="nasq-metadata">
            <div><dt>{{ t('meetingsUi.state.' + query.data.value.state) }}</dt><dd>{{ query.data.value.reference }}</dd></div>
            <div><dt>{{ t('meetingsUi.date') }}</dt><dd>{{ query.data.value.meeting_date }}</dd></div>
            <div><dt>{{ t('meetingsUi.start') }}</dt><dd>{{ localTime(query.data.value.start_datetime) }}</dd></div>
            <div><dt>{{ t('meetingsUi.end') }}</dt><dd>{{ localTime(query.data.value.end_datetime) }}</dd></div>
            <div><dt>{{ t('meetingsUi.organizer') }}</dt><dd>{{ query.data.value.organizer?.name }}</dd></div>
            <div><dt>{{ t('meetingsUi.secretary') }}</dt><dd>{{ query.data.value.secretary?.name || '—' }}</dd></div>
            <div><dt>{{ t('meetingsUi.location') }}</dt><dd>{{ query.data.value.location || '—' }}</dd></div>
            <div v-if="query.data.value.meeting_url">
              <dt>{{ t('meetingsUi.url') }}</dt>
              <dd><a :href="query.data.value.meeting_url" target="_blank" rel="noopener" class="text-brand-link underline" dir="ltr">{{ query.data.value.meeting_url }}</a></dd>
            </div>
          </dl>
          <p class="mt-3 text-sm">{{ t('meetingsUi.attendees') }}: {{ query.data.value.attendees.map(person => person.name).join('، ') || '—' }}</p>
        </section>
        <section class="nasq-panel nasq-panel-body">
          <h2 class="mb-2 text-sm font-semibold">{{ t('meetingsUi.agenda') }}</h2>
          <div class="prose prose-sm max-w-none" v-html="query.data.value.agenda" />
          <h2 class="mt-4 mb-2 text-sm font-semibold">{{ t('meetingsUi.minutes') }}</h2>
          <div class="prose prose-sm max-w-none" v-html="query.data.value.minutes" />
        </section>
        <section class="nasq-panel nasq-panel-body">
          <div class="mb-3 flex items-center gap-2">
            <Paperclip class="size-[18px] text-muted-foreground" />
            <h2 class="text-sm font-semibold">{{ t('attachments.title') }}</h2>
          </div>
          <ul>
            <li v-for="attachment in attachments.data.value?.items ?? []" :key="attachment.id" class="flex items-center gap-2 border-b border-border py-2 last:border-0">
              <a :href="attachment.url" class="min-w-0 flex-1 truncate text-brand-link underline" target="_blank" rel="noopener">{{ attachment.name }}</a>
              <Button v-if="query.data.value.can_edit && pendingDeleteId !== attachment.id" type="button" variant="ghost" size="icon" class="size-[32px] rounded-lg" :aria-label="t('attachments.delete')" :disabled="!hydrated || deleting" @click="pendingDeleteId = attachment.id">
                <Trash2 class="size-[18px]" />
              </Button>
              <div v-if="pendingDeleteId === attachment.id" class="flex gap-2">
                <Button type="button" variant="outline" size="sm" @click="pendingDeleteId = null">{{ t('app.cancel') }}</Button>
                <Button type="button" variant="destructive" size="sm" @click="confirmDelete(attachment.id)">{{ t('attachments.confirm') }}</Button>
              </div>
            </li>
          </ul>
          <input v-if="query.data.value.can_edit" class="mt-3 border-input h-9 w-full rounded-lg border px-3 text-sm" type="file" :disabled="!hydrated || uploading" @change="onFileChange">
        </section>
        <section class="nasq-panel nasq-panel-body grid gap-3">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-sm font-semibold">{{ t('meetingsUi.resolutions') }}</h2>
            <NuxtLink v-if="query.data.value.can_edit" :to="{ path: `/meetings/${id}/resolutions/new`, query: returnToQuery(route.fullPath) }">
              <Button size="sm">{{ t('meetingsUi.newResolution') }}</Button>
            </NuxtLink>
          </div>
          <div v-for="item in query.data.value.resolutions" :key="item.id" class="grid gap-2 border-b border-border py-3 last:border-0">
            <p class="font-medium">{{ item.name }}</p>
            <p class="text-sm text-muted-foreground">{{ item.responsible?.name }} · {{ item.deadline }} · {{ t(`meetingsUi.priorityLabel.${item.priority}`) }} · {{ t(`meetingsUi.resolutionState.${item.state}`) }}</p>
            <NuxtLink v-if="item.task_id" :to="`/tasks/${item.task_id}`" class="text-sm text-brand-link">{{ t('meetingsUi.openTask') }}</NuxtLink>
            <div v-else-if="query.data.value.can_edit" class="flex flex-wrap items-center gap-2">
              <select class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated || converting" @change="projectByResolution[item.id] = Number(($event.target as HTMLSelectElement).value)">
                <option value="">{{ t('meetingsUi.project') }}</option>
                <option v-for="project in projects ?? []" :key="project.id" :value="project.id">{{ project.name }}</option>
              </select>
              <Button size="sm" :disabled="!hydrated || converting || !projectByResolution[item.id]" @click="convertResolution(item.id)">{{ t('meetingsUi.convert') }}</Button>
            </div>
          </div>
        </section>
      </div>
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage v-else />
</template>
