<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { formatDateTime } from '@webvue/ui/app/utils/formatDate'
import { useAdminAccounts } from '@/composables/useAdminAccounts'
import { useTeamActions } from '@/composables/useTeamActions'
import type { TeamAccount, TeamAccountStatus } from '@/utils/team'

definePageMeta({ capability: 'vendor.accounts.manage' })
const { t } = useI18n()
const accounts = useAdminAccounts()
const { me, can } = useAdminSession()
const hydrated = useHydrated()
const { data, error, pending, refresh } = await useAsyncData('vendor:team', () => accounts.list())
const team = useTeamActions(refresh)
const { panel, busy, errorKey, notice, invitation } = team
const items = computed<TeamAccount[]>(() => data.value?.items ?? [])
const allowed = computed(() => can('vendor.accounts.manage'))

const TONES: Record<TeamAccountStatus, 'success' | 'warning' | 'neutral'> = { active: 'success', enrolling: 'warning', disabled: 'neutral' }
const ICONS = { roles: 'i-lucide-shield-check', reset: 'i-lucide-key-round', disable: 'i-lucide-user-x' } as const
const isMe = (account: TeamAccount) => account.id === me.value?.id
const lastSeen = (account: TeamAccount) => (account.last_seen_at ? formatDateTime(account.last_seen_at) : t('team.neverSeen'))

// A disabled account cannot be changed; a pending invitation can get a new link (reset) or be disabled.
// Nobody disables or re-enrolls their own account here: that would end their own session.
const actionsOf = (account: TeamAccount) => (account.status === 'disabled'
  ? []
  : (isMe(account) ? ['roles'] as const : ['roles', 'reset', 'disable'] as const).map(kind => ({ kind, label: t(`team.actions.${kind}`), icon: ICONS[kind] })))

const columns = computed<TableColumn<TeamAccount>[]>(() => [
  { id: 'person', header: t('team.columns.person') },
  { id: 'roles', header: t('team.columns.roles') },
  { id: 'status', header: t('team.columns.status') },
  { id: 'lastSeen', header: t('team.columns.lastSeen') },
  { id: 'actions', header: t('team.columns.actions') },
])
</script>

<template>
  <SharedListPage :title="t('team.title')" :description="t('team.description')" :create-to="allowed ? '/team/new' : undefined" :create-label="t('team.invite')" create-test-id="team-invite">
    <TeamInvitationLink v-if="invitation" :key="invitation.link" v-bind="invitation" @dismiss="team.dismissInvitation" />
    <UAlert v-if="notice" role="status" color="success" variant="subtle" icon="i-lucide-check" :title="t(notice.key, { name: notice.name })" data-testid="team-notice" />

    <TeamAccountAction v-if="panel" :key="`${panel.kind}:${panel.account.id}`" :kind="panel.kind" :account="panel.account" :busy="busy" :error-key="errorKey" @confirm="team.confirm" @cancel="team.close" />

    <SharedDataTable :rows="items" :columns="columns" row-key="id" :loading="pending" :error="error" :empty-text="t('team.empty')" :caption="t('team.title')" @retry="refresh">
      <template #person-cell="{ row: { original: account } }">
        <div class="min-w-0">
          <p class="font-medium text-highlighted">
            {{ account.display_name }}<span v-if="isMe(account)" class="ms-2 text-xs font-normal text-muted">({{ t('team.you') }})</span>
          </p>
          <p class="text-sm text-muted" dir="ltr">
            {{ account.email }}
          </p>
        </div>
      </template>
      <template #roles-cell="{ row: { original: account } }">
        <div class="flex flex-wrap gap-1" data-testid="team-role-badges">
          <SharedStatusBadge v-for="role in account.roles" :key="role" :tone="role === 'owner' ? 'primary' : 'neutral'" :label="t(`team.roles.${role}`)" />
        </div>
      </template>
      <template #status-cell="{ row: { original: account } }">
        <SharedStatusBadge :tone="TONES[account.status]" :label="t(`team.status.${account.status}`)" />
      </template>
      <template #lastSeen-cell="{ row: { original: account } }">
        {{ lastSeen(account) }}
      </template>
      <template #actions-cell="{ row: { original: account } }">
        <div class="flex flex-wrap gap-1" role="group" :aria-label="t('team.actions.label', { name: account.display_name })">
          <UButton
            v-for="action in actionsOf(account)"
            :key="action.kind"
            type="button"
            size="sm"
            color="neutral"
            variant="ghost"
            :icon="action.icon"
            :label="action.label"
            :disabled="!hydrated || busy"
            :data-testid="`team-${action.kind}`"
            @click="team.open({ kind: action.kind, account })"
          />
          <p v-if="isMe(account) && account.status !== 'disabled'" class="basis-full text-xs text-muted">
            {{ t('team.actions.selfHint') }}
          </p>
        </div>
      </template>
      <template #mobile-row="{ row: account }">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold">
              {{ account.display_name }}<span v-if="isMe(account)" class="ms-2 text-xs font-normal text-muted">({{ t('team.you') }})</span>
            </h2>
            <p class="text-sm text-muted" dir="ltr">
              {{ account.email }}
            </p>
          </div>
          <SharedStatusBadge :tone="TONES[account.status]" :label="t(`team.status.${account.status}`)" />
        </div>
        <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt class="text-muted">{{ t('team.columns.roles') }}</dt><dd class="mt-1 flex flex-wrap gap-1"><SharedStatusBadge v-for="role in account.roles" :key="role" :tone="role === 'owner' ? 'primary' : 'neutral'" :label="t(`team.roles.${role}`)" /></dd></div>
          <div><dt class="text-muted">{{ t('team.columns.lastSeen') }}</dt><dd>{{ lastSeen(account) }}</dd></div>
        </dl>
        <div class="mt-3 flex flex-wrap gap-1" role="group" :aria-label="t('team.actions.label', { name: account.display_name })">
          <UButton
            v-for="action in actionsOf(account)"
            :key="action.kind"
            type="button"
            size="sm"
            color="neutral"
            variant="outline"
            :icon="action.icon"
            :label="action.label"
            :disabled="!hydrated || busy"
            @click="team.open({ kind: action.kind, account })"
          />
          <p v-if="isMe(account) && account.status !== 'disabled'" class="basis-full text-xs text-muted">
            {{ t('team.actions.selfHint') }}
          </p>
        </div>
      </template>
    </SharedDataTable>
  </SharedListPage>
</template>
