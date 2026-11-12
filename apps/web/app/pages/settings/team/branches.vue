<script setup lang="ts">
import BranchPresetCard from '@/components/access/branches/BranchPresetCard.vue'
import BranchPolicyCard from '@/components/access/branches/BranchPolicyCard.vue'
import BranchMembersCard from '@/components/access/branches/BranchMembersCard.vue'
import { ApiError } from '@/composables/useApi'
import { useBranchPolicy, useBranchSeats, useSetBranchSeat } from '@/composables/useBranchAccess'
import { useCreateBranch } from '@/composables/useCreateBranch'
import { useAdminRoles } from '@/composables/useAdminRoles'
import { useMembershipBranches } from '@/composables/useMemberships'
import { MAX_SEAT_PRIORITY, type BranchSeat } from '@liwan/contracts'
import { accessErrorMessage } from '@/utils/accessErrors'

const { t } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const identity = computed(() => me.value ? `${me.value.id}:${me.value.company.id}` : null)
const canSeeSeats = computed(() => can('settings.company.manage'))
const canCreate = computed(() => canSeeSeats.value && me.value?.read_only === false)
// Owner decision 2026-10-29, option c: in SaaS a branch is bought, and the paid order creates it.
const purchaseOnly = computed(() => me.value?.commercial?.mode === 'saas')
const hydrated = useHydrated()
const branchSeats = useBranchSeats(canSeeSeats)
const setBranchSeat = useSetBranchSeat()
const branchSeatRefused = computed(() => branchSeats.error.value instanceof ApiError && branchSeats.error.value.status === 403)
const branchSeatDraft = ref<{ id: number; originalReadOnly: boolean; originalPriority: number; identity: string | null } | null>(null)
const draftReadOnly = ref(false)
const draftPriority = ref<number | undefined>(0)
const branchSeatError = ref('')
const priorityValid = computed(() => draftPriority.value !== undefined && Number.isInteger(draftPriority.value) && draftPriority.value >= 0 && draftPriority.value <= MAX_SEAT_PRIORITY)
const branchSeatDirty = computed(() => !!branchSeatDraft.value && (
  draftReadOnly.value !== branchSeatDraft.value.originalReadOnly || draftPriority.value !== branchSeatDraft.value.originalPriority
))
function startBranchSeatEdit(branch: BranchSeat) {
  if (!canCreate.value || !hydrated.value || setBranchSeat.isPending.value) return
  branchSeatError.value = ''
  branchSeatDraft.value = { id: branch.id, originalReadOnly: branch.read_only, originalPriority: branch.restore_priority, identity: identity.value }
  draftReadOnly.value = branch.read_only
  draftPriority.value = branch.restore_priority
}
async function saveBranchSeat() {
  const draft = branchSeatDraft.value
  const priority = draftPriority.value
  if (!draft || draft.identity !== identity.value || !canCreate.value || !hydrated.value || setBranchSeat.isPending.value || !branchSeatDirty.value || !priorityValid.value || priority === undefined) return
  branchSeatError.value = ''
  try {
    await setBranchSeat.mutateAsync({ id: draft.id, body: {
      ...(draftReadOnly.value !== draft.originalReadOnly ? { read_only: draftReadOnly.value } : {}),
      ...(priority !== draft.originalPriority ? { priority } : {}),
    } })
    if (branchSeatDraft.value === draft) branchSeatDraft.value = null
  } catch (error) {
    if (branchSeatDraft.value === draft) branchSeatError.value = accessErrorMessage(error, t)
  }
}
watch(identity, () => {
  branchSeatDraft.value = null
  branchSeatError.value = ''
})

const create = useCreateBranch()
const branchName = ref('')
const createFailure = ref('')
const created = ref(false)
const canSubmit = computed(() => canCreate.value && hydrated.value && !create.isPending.value && branchName.value.trim().length > 0)
async function submitBranch() {
  if (!canSubmit.value) return
  createFailure.value = ''
  created.value = false
  try {
    await create.mutateAsync({ name: branchName.value })
    branchName.value = ''
    created.value = true
  } catch (error) {
    createFailure.value = error instanceof ApiError ? error.message : t('errors.generic')
  }
}
const forbidden = computed(() => !can('access.users.assign_roles') || !can('access.roles.read'))
const query = useBranchPolicy(computed(() => !forbidden.value))
// The members section lists every branch below the root company, not only the ones the policy names, so the first member of a
// new branch can be added. It stands on its own queries: the policy loading or failing does not hide it. Only the root company
// has branches below it, so in a branch the list is empty and the section is not drawn. The roles are the ones the users pages
// offer, and each card applies the one role rule for its branch.
const canGrant = computed(() => can('access.users.grant'))
const memberBranches = useMembershipBranches(canGrant)
const memberRoles = useAdminRoles({}, computed(() => canGrant.value && can('access.roles.read')))
const showMembers = computed(() => canGrant.value && (!!memberBranches.error.value || !!memberBranches.data.value?.items.length))
async function reloadPolicy() {
  const result = await query.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('access.branches.title')" back-to="/settings/team" />
    <SharedRecordSection v-if="canSeeSeats && !branchSeatRefused" id="branch-seats" variant="panel" :title="t('access.seats.branchTitle')">
      <SharedPageState :loading="branchSeats.isLoading.value" :error="branchSeats.error.value" @retry="branchSeats.refetch()">
        <div v-if="branchSeats.data.value" class="grid gap-(--liwan-gap-card)">
          <p class="text-sm text-muted">
            {{ t('access.seats.branchUsage', { full: branchSeats.data.value.total - branchSeats.data.value.read_only, limit: branchSeats.data.value.limit ?? t('access.seats.unlimited') }) }}
          </p>
          <p v-if="!branchSeats.data.value.items.length" class="text-sm text-muted">{{ t('access.seats.noBranches') }}</p>
          <ul v-else class="grid gap-(--liwan-gap-card)">
            <SharedSubCard v-for="branch in branchSeats.data.value.items" :key="branch.id" as="li">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <span class="font-medium">{{ branch.name }}</span>
                  <SharedStatusBadge :tone="branch.read_only ? 'warning' : 'success'" :label="t(branch.read_only ? 'access.seats.readOnly' : 'access.seats.full')" />
                </div>
                <UButton v-if="canCreate && branchSeatDraft?.id !== branch.id" size="sm" color="neutral" variant="outline" :disabled="!hydrated || !!branchSeatDraft || setBranchSeat.isPending.value" @click="startBranchSeatEdit(branch)">{{ t('access.seats.edit') }}</UButton>
              </div>
              <form v-if="canCreate && branchSeatDraft?.id === branch.id" class="mt-3 grid gap-(--liwan-gap-card)" @submit.prevent="saveBranchSeat">
                <UCheckbox v-model="draftReadOnly" :label="t('access.seats.markReadOnly')" :description="t('access.seats.branchReadOnlyHint')" :disabled="!hydrated || setBranchSeat.isPending.value" />
                <UFormField :label="t('access.seats.priority')" :help="t('access.seats.priorityHint')" :error="priorityValid ? undefined : t('access.seats.priorityInvalid')" name="branch-seat-priority">
                  <UInputNumber v-model="draftPriority" :min="0" :max="MAX_SEAT_PRIORITY" :disabled="!hydrated || setBranchSeat.isPending.value" />
                </UFormField>
                <UAlert v-if="branchSeatError" role="alert" color="error" variant="subtle" :title="branchSeatError" />
                <SharedFormActions>
                  <UButton type="submit" :loading="setBranchSeat.isPending.value" :disabled="!hydrated || setBranchSeat.isPending.value || !branchSeatDirty || !priorityValid">{{ t('access.seats.save') }}</UButton>
                  <UButton type="button" color="neutral" variant="outline" :disabled="setBranchSeat.isPending.value" @click="branchSeatDraft = null">{{ t('app.cancel') }}</UButton>
                </SharedFormActions>
              </form>
            </SharedSubCard>
          </ul>
        </div>
      </SharedPageState>
      <SharedUnsavedChanges :dirty="branchSeatDirty" />
    </SharedRecordSection>
    <SharedRecordSection v-if="canCreate && purchaseOnly" variant="panel" data-testid="branch-purchase" :title="t('access.branches.create.title')" :description="t('access.branches.create.purchaseDescription')">
      <UButton to="/subscription/branches/new" icon="i-lucide-plus" :disabled="!hydrated">{{ t('access.branches.create.purchase') }}</UButton>
    </SharedRecordSection>
    <SharedRecordSection v-else-if="canCreate" variant="panel" data-testid="branch-create" :title="t('access.branches.create.title')" :description="t('access.branches.create.description')">
      <form class="liwan-form" @submit.prevent="submitBranch">
        <UFormField :label="t('access.branches.create.name')" name="branch-name">
          <UInput v-model="branchName" maxlength="200" class="w-full" :disabled="!hydrated || create.isPending.value" />
        </UFormField>
        <UAlert v-if="createFailure" color="error" variant="subtle" :title="createFailure" />
        <p v-else-if="created" role="status" class="text-sm text-muted">{{ t('access.branches.create.done') }}</p>
        <div><UButton type="submit" icon="i-lucide-plus" :loading="create.isPending.value" :disabled="!canSubmit">{{ t('access.branches.create.action') }}</UButton></div>
      </form>
    </SharedRecordSection>
    <SharedForbiddenState v-if="forbidden && !canCreate" :description="t('access.forbidden')" />
    <SharedPageState v-else-if="!forbidden" :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <!-- Keyed by the signed-in user and company, so a draft never outlives the identity it was made for. -->
      <div v-if="query.data.value" :key="identity ?? ''" class="grid gap-(--liwan-gap-card)">
        <BranchPresetCard :policy="query.data.value" :reload-policy="reloadPolicy" />
        <BranchPolicyCard :policy="query.data.value" :reload-policy="reloadPolicy" />
      </div>
    </SharedPageState>
    <!-- Keyed by the signed-in user and company, so a draft never outlives the identity it was made for. -->
    <SharedRecordSection v-if="showMembers" id="branch-members" :key="`members-${identity ?? ''}`" variant="panel" :title="t('access.members.branchTitle')" :description="t('access.members.branchDescription')">
      <SharedPageState :loading="memberBranches.isLoading.value" :error="memberBranches.error.value" @retry="memberBranches.refetch()">
        <ul class="grid gap-(--liwan-gap-card)">
          <BranchMembersCard v-for="branch in memberBranches.data.value?.items ?? []" :key="branch.id" :branch="branch" :roles="memberRoles.data.value?.items ?? []" />
        </ul>
      </SharedPageState>
    </SharedRecordSection>
  </SharedSettingsPage>
</template>
