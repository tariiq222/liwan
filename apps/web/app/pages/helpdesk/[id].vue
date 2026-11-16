<script setup lang="ts">
import type { PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import type { HelpdeskAction } from '@/composables/helpdesk/useHelpdesk'
import { useHelpdeskAction, useHelpdeskReference, useHelpdeskTicket } from '@/composables/helpdesk/useHelpdesk'
import { HELPDESK_LIST_PATH } from '@/composables/helpdesk/helpdeskKeys'
import { HELPDESK_PRIORITY_TONE, HELPDESK_SLA_TONE } from '@/components/helpdesk/helpdeskStatus'
import HelpdeskMergeSection from '@/components/helpdesk/HelpdeskMergeSection.vue'
import HelpdeskThread from '@/components/helpdesk/HelpdeskThread.vue'
import { STATUS_COLOR } from '@liwan/ui/app/utils/statusTone'
import { recordParentTo } from '@/utils/recordListOrigin'
import { safeListReturnTo } from '@/composables/useRouteListFilters'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const id = computed(() => Number(route.params.id))
const query = useHelpdeskTicket(id)
const reference = useHelpdeskReference()
const ticket = computed(() => query.data.value ?? null)
const action = useHelpdeskAction()
const sourcePaths = useRecordListPaths([HELPDESK_LIST_PATH])
const backTo = computed(() => recordParentTo(`${HELPDESK_LIST_PATH}/${id.value}`, {
  ...route.query, listOrigin: route.query.listOrigin ?? route.query.returnTo ?? null,
}, sourcePaths.value, route.hash))
const failure = ref<string | null>(null)
const editable = computed(() => !ticket.value?.stage.closed)
const canWrite = computed(() => can('helpdesk.tickets.write'))
const canRequest = computed(() => can('helpdesk.requests.read'))
const canAssign = computed(() => can('helpdesk.tickets.assign'))
const canClose = computed(() => can('helpdesk.tickets.close'))
const canMerge = computed(() => can('helpdesk.tickets.merge'))
function reload() { void query.refetch() }

const headerTags = computed<PageHeaderTag[]>(() => {
  if (!ticket.value) return []
  const tags: PageHeaderTag[] = [{ label: ticket.value.stage.name, tone: ticket.value.stage.closed ? 'neutral' : 'info' }]
  tags.push({ label: t(`helpdesk.priority.${ticket.value.priority}`), tone: STATUS_COLOR[HELPDESK_PRIORITY_TONE[ticket.value.priority]] })
  if (ticket.value.sla.state !== 'none') {
    tags.push({ label: t(`helpdesk.sla.${ticket.value.sla.state}`), tone: STATUS_COLOR[HELPDESK_SLA_TONE[ticket.value.sla.state]] })
  }
  return tags
})
const stages = computed(() => (reference.data.value?.stages ?? []).filter(stage => !stage.closed || ticket.value?.stage.closed))
const stageItems = computed(() => stages.value.map(stage => ({ value: stage.id, label: stage.name })))
const assignedToMe = computed(() => ticket.value?.assignee?.id === me.value?.id)

const copied = ref(false)
async function copyLink(link: string) {
  try {
    await navigator.clipboard.writeText(link)
    copied.value = true
  } catch {
    copied.value = false
  }
}
async function run(body: HelpdeskAction) {
  if (!ticket.value || action.isPending.value) return
  failure.value = null
  try {
    await action.mutateAsync({ id: ticket.value.id, body })
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('helpdesk.record.failed')
  }
}
const assignToMe = () => run({ action: 'assign', assignee_id: me.value?.id ?? null })
const release = () => run({ action: 'assign', assignee_id: null })
const setStage = (value: number) => run({ action: 'stage', stage_id: Number(value) })
const close = () => run({ action: 'close' })
const reopen = () => run({ action: 'reopen' })
</script>

<template>
  <SharedRecordPage
    :title="ticket ? `${ticket.number} · ${ticket.subject}` : t('helpdesk.record.loading')"
    :tags="headerTags"
    :back-to="backTo"
    :back-label="t('helpdesk.title')"
    :loading="query.isLoading.value"
    :error="query.error.value"
    aside-first
    @retry="query.refetch"
  >
    <template v-if="ticket" #actions>
      <div class="flex flex-wrap items-center gap-2">
        <USelect v-if="canWrite && !ticket.stage.closed && stageItems.length" :model-value="ticket.stage.id" :items="stageItems" :aria-label="t('helpdesk.record.stage')" :disabled="action.isPending.value" data-testid="helpdesk-stage-move" @update:model-value="setStage" />
        <UButton v-if="canWrite && editable" color="neutral" variant="outline" icon="i-lucide-pencil" :label="t('app.edit')" :to="{ path: `/helpdesk/${ticket.id}/edit`, query: { returnTo: route.fullPath } }" data-testid="helpdesk-edit" />
        <UButton v-if="canAssign && !assignedToMe" color="neutral" variant="outline" icon="i-lucide-user-check" :label="t('helpdesk.record.take')" :loading="action.isPending.value" data-testid="helpdesk-take" @click="assignToMe" />
        <UButton v-if="canAssign && assignedToMe" color="neutral" variant="outline" icon="i-lucide-user-x" :label="t('helpdesk.record.release')" :loading="action.isPending.value" data-testid="helpdesk-release" @click="release" />
        <UButton v-if="canClose && !ticket.stage.closed" icon="i-lucide-check" :label="t('helpdesk.record.close')" :loading="action.isPending.value" data-testid="helpdesk-close" @click="close" />
        <UButton v-if="canClose && ticket.stage.closed" color="neutral" variant="outline" icon="i-lucide-rotate-ccw" :label="t('helpdesk.record.reopen')" :loading="action.isPending.value" data-testid="helpdesk-reopen" @click="reopen" />
      </div>
    </template>
    <template v-if="ticket" #aside>
      <SharedRecordSection variant="panel" :title="t('helpdesk.record.details')" data-testid="helpdesk-details">
        <SharedPropertyRow :label="t('helpdesk.record.requester')" :value="ticket.requester.name" />
        <SharedPropertyRow :label="t('helpdesk.record.assignee')" :value="ticket.assignee?.name ?? t('helpdesk.unassigned')" />
        <SharedPropertyRow :label="t('helpdesk.columns.team')" :value="ticket.team?.name ?? '—'" />
        <SharedPropertyRow :label="t('helpdesk.record.category')" :value="ticket.category?.name ?? '—'" />
        <SharedPropertyRow :label="t('helpdesk.record.type')" :value="ticket.type?.name ?? '—'" />
        <SharedPropertyRow :label="t('helpdesk.record.channel')" :value="ticket.channel?.name ?? '—'" />
        <SharedPropertyRow :label="t('helpdesk.record.created')" :value="formatDate(ticket.created_at)" />
        <SharedPropertyRow :label="t('helpdesk.record.firstResponse')" :value="ticket.first_response.at ? formatDate(ticket.first_response.at) : t('helpdesk.record.pending')" />
        <SharedPropertyRow v-if="ticket.sla.deadline" :label="t('helpdesk.record.slaDeadline')" :value="formatDate(ticket.sla.deadline)" />
        <SharedPropertyRow v-if="ticket.closed_at" :label="t('helpdesk.record.closedAt')" :value="formatDate(ticket.closed_at)" />
      </SharedRecordSection>
      <SharedRecordSection v-if="ticket.portal_link" variant="panel" :title="t('helpdesk.record.portal')" data-testid="helpdesk-portal-link">
        <p class="text-sm text-muted">{{ t('helpdesk.record.portalHint') }}</p>
        <div class="mt-2 flex items-center gap-2">
          <UInput :model-value="ticket.portal_link" readonly class="w-full" :aria-label="t('helpdesk.record.portal')" data-testid="helpdesk-portal-url" />
          <UButton color="neutral" variant="outline" icon="i-lucide-copy" :label="t('helpdesk.record.copy')" :data-testid="'helpdesk-portal-copy'" @click="copyLink(ticket.portal_link)" />
        </div>
      </SharedRecordSection>
      <SharedRecordSection v-if="ticket.related.length" variant="panel" :title="t('helpdesk.record.related')">
        <ul class="flex flex-col gap-2">
          <li v-for="related in ticket.related" :key="related.id">
            <NuxtLink :to="`/helpdesk/${related.id}`" class="text-sm font-medium text-highlighted hover:underline">
              <bdi dir="ltr">{{ related.number }}</bdi> · {{ related.subject }}
            </NuxtLink>
          </li>
        </ul>
      </SharedRecordSection>
    </template>
    <template v-if="ticket">
      <p v-if="failure" class="mb-3 text-sm text-error" role="alert" data-testid="helpdesk-action-error">{{ failure }}</p>
      <p v-if="copied" class="mb-3 text-sm text-success">{{ t('helpdesk.record.copied') }}</p>
      <SharedRecordSection variant="panel" :title="t('helpdesk.record.description')" data-testid="helpdesk-description">
        <SharedRichText :html="ticket.description" />
      </SharedRecordSection>
      <HelpdeskMergeSection v-if="canMerge && !ticket.stage.closed" class="mt-4" :ticket-id="ticket.id" @merged="reload" />
      <HelpdeskThread
        class="mt-4"
        :ticket-id="ticket.id"
        :attachments="ticket.attachments"
        :closed="ticket.stage.closed"
        :can-write="canWrite"
        :can-request="canRequest"
      />
    </template>
  </SharedRecordPage>
</template>
