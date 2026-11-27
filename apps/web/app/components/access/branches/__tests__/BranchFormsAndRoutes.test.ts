import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { MAX_SEAT_PRIORITY } from '@liwan/contracts'
import { ApiError } from '../../../../composables/useApi'
import { accessErrorMessage } from '../../../../utils/accessErrors'
import { saveErrorMessage } from '../../../../utils/formFeedback'
import { mutation, setupSfc } from '../../__tests__/sfcSetup'

const branchSeat = (over: Partial<{ id: number; name: string; read_only: boolean; seat_choice: 'auto' | 'customer'; restore_priority: number }> = {}) => ({
  id: 7, name: 'Jeddah Branch', read_only: false, seat_choice: 'auto' as const, restore_priority: 2, ...over,
})

describe('BranchCreateForm', () => {
  function mountForm(createFn: (...args: any[]) => Promise<unknown> = async () => ({ id: 9, name: 'Riyadh' })) {
    const mutate = vi.fn(createFn)
    const { state, emit } = setupSfc(resolve(import.meta.dirname, '../BranchCreateForm.vue'), {}, {
      saveErrorMessage,
      useCreateBranch: () => mutation(mutate),
      useId: () => 'branch-create-form',
    })
    return { state, emit, mutate }
  }

  it('validates only after the first submit attempt and blocks empty names', async () => {
    const { state, emit, mutate } = mountForm()
    expect(state.attempted.value).toBe(false)
    state.branchName.value = '   '
    await state.submitBranch()
    expect(state.attempted.value).toBe(true)
    expect(mutate).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('marks the form saved before emitting done so unsaved-changes guards do not block navigation', async () => {
    const dirtyWhenDone: boolean[] = []
    const { state, emit, mutate } = mountForm()
    emit.mockImplementation((event: string) => {
      if (event === 'done') dirtyWhenDone.push(state.dirty.value)
    })
    state.branchName.value = 'Riyadh Branch'
    expect(state.dirty.value).toBe(true)
    await state.submitBranch()
    expect(mutate).toHaveBeenCalledWith({ name: 'Riyadh Branch' })
    expect(state.saved.value).toBe(true)
    expect(state.dirty.value).toBe(false)
    expect(dirtyWhenDone).toEqual([false])
    expect(emit).toHaveBeenCalledWith('done')
  })

  it('preserves server and disconnected-write error messages on failure', async () => {
    const server = mountForm(async () => { throw new ApiError(422, 'limit_reached', 'Branch limit reached') })
    server.state.branchName.value = 'Riyadh Branch'
    await server.state.submitBranch()
    expect(server.state.error.value).toBe('Branch limit reached')
    expect(server.state.saved.value).toBe(false)
    expect(server.emit).not.toHaveBeenCalled()

    const disconnected = mountForm(async () => { throw new ApiError(0, 'network', 'Failed to fetch') })
    disconnected.state.branchName.value = 'Riyadh Branch'
    await disconnected.state.submitBranch()
    expect(disconnected.state.error.value).toBe('errors.saveUncertain')
    expect(disconnected.state.saved.value).toBe(false)
  })
})

describe('BranchSeatForm', () => {
  function mountForm(over: { branch?: ReturnType<typeof branchSeat>; identity?: string | null; save?: (...args: any[]) => Promise<unknown> } = {}) {
    const mutate = vi.fn(over.save ?? (async () => ({})))
    const props = Vue.reactive({ branch: over.branch ?? branchSeat(), identity: over.identity === undefined ? '7:1' : over.identity })
    const { state, emit } = setupSfc(resolve(import.meta.dirname, '../BranchSeatForm.vue'), props, {
      MAX_SEAT_PRIORITY,
      accessErrorMessage,
      useSetBranchSeat: () => mutation(mutate),
      useId: () => 'branch-seat-form',
    })
    return { state, emit, mutate, props }
  }

  it('sends only changed fields in the PATCH body and marks saved before emitting done', async () => {
    const dirtyWhenDone: boolean[] = []
    const onlyReadOnly = mountForm()
    onlyReadOnly.emit.mockImplementation((event: string) => {
      if (event === 'done') dirtyWhenDone.push(onlyReadOnly.state.dirty.value)
    })
    onlyReadOnly.state.draftReadOnly.value = true
    await onlyReadOnly.state.saveBranchSeat()
    expect(onlyReadOnly.mutate).toHaveBeenCalledWith({ id: 7, body: { read_only: true } })
    expect(dirtyWhenDone).toEqual([false])

    const onlyPriority = mountForm()
    onlyPriority.state.draftPriority.value = 5
    await onlyPriority.state.saveBranchSeat()
    expect(onlyPriority.mutate).toHaveBeenCalledWith({ id: 7, body: { priority: 5 } })

    const both = mountForm()
    both.state.draftReadOnly.value = true
    both.state.draftPriority.value = 9
    await both.state.saveBranchSeat()
    expect(both.mutate).toHaveBeenCalledWith({ id: 7, body: { read_only: true, priority: 9 } })
  })

  it('validates priority after submit attempt and rejects out-of-range or non-integer values', async () => {
    const { state, mutate } = mountForm()
    expect(state.attempted.value).toBe(false)
    for (const invalid of [-1, 1.5, MAX_SEAT_PRIORITY + 1, undefined]) {
      state.draftPriority.value = invalid
      await state.saveBranchSeat()
      expect(state.attempted.value).toBe(true)
      expect(state.priorityValid.value).toBe(false)
    }
    expect(mutate).not.toHaveBeenCalled()
    state.draftPriority.value = MAX_SEAT_PRIORITY
    expect(state.priorityValid.value).toBe(true)
    await state.saveBranchSeat()
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('refuses saving when identity changed before submit or mid-flight before emitting done', async () => {
    const beforeSubmit = mountForm({ identity: '7:1' })
    beforeSubmit.state.draftReadOnly.value = true
    beforeSubmit.props.identity = '8:1'
    await beforeSubmit.state.saveBranchSeat()
    expect(beforeSubmit.mutate).not.toHaveBeenCalled()
    expect(beforeSubmit.emit).not.toHaveBeenCalled()

    let resolveSave!: () => void
    const midFlight = mountForm({
      identity: '7:1',
      save: () => new Promise<void>(resolvePromise => { resolveSave = resolvePromise }),
    })
    midFlight.state.draftReadOnly.value = true
    const pending = midFlight.state.saveBranchSeat()
    midFlight.props.identity = '8:1'
    resolveSave()
    await pending
    expect(midFlight.mutate).toHaveBeenCalledTimes(1)
    expect(midFlight.state.saved.value).toBe(false)
    expect(midFlight.emit).not.toHaveBeenCalled()
  })
})

describe('branch routes', () => {
  it('branches/new.vue blocks SaaS mode, read-only admins, and missing capability', () => {
    const mountNew = (over: { caps?: string[]; readOnly?: boolean; mode?: 'saas' | 'non_saas' } = {}) => {
      const caps = over.caps ?? ['settings.company.manage']
      return setupSfc(resolve(import.meta.dirname, '../../../../pages/settings/team/branches/new.vue'), {}, {
        BranchCreateForm: {},
        useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
        useAccess: () => ({ can: (key: string) => caps.includes(key) }),
        useMe: () => ({ me: Vue.ref({ id: 7, company: { id: 1 }, read_only: over.readOnly ?? false, commercial: { mode: over.mode ?? 'non_saas' } }) }),
      }).state
    }
    const saas = mountNew({ mode: 'saas' })
    expect(saas.purchaseOnly.value).toBe(true)
    expect(!saas.canCreate.value || saas.purchaseOnly.value).toBe(true)

    const readOnly = mountNew({ readOnly: true })
    expect(readOnly.canCreate.value).toBe(false)

    const noCap = mountNew({ caps: ['access.users.assign_roles'] })
    expect(noCap.canCreate.value).toBe(false)

    const allowed = mountNew()
    expect(allowed.canCreate.value).toBe(true)
    expect(allowed.purchaseOnly.value).toBe(false)
  })

  it('branches/[branchId]/edit.vue rejects invalid IDs, missing branches, and read-only admins without firing queries', () => {
    const mountEdit = (over: { branchId?: string; caps?: string[]; readOnly?: boolean; items?: ReturnType<typeof branchSeat>[] | null; error?: unknown } = {}) => {
      const caps = over.caps ?? ['settings.company.manage']
      const enabledCalls: Vue.Ref<boolean>[] = []
      const { state } = setupSfc(resolve(import.meta.dirname, '../../../../pages/settings/team/branches/[branchId]/edit.vue'), {}, {
        ApiError,
        BranchSeatForm: {},
        useRoute: () => ({ params: { branchId: over.branchId ?? '7' } }),
        useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
        useAccess: () => ({ can: (key: string) => caps.includes(key) }),
        useMe: () => ({ me: Vue.ref({ id: 7, company: { id: 1 }, read_only: over.readOnly ?? false }) }),
        useBranchSeats: (enabled: Vue.Ref<boolean>) => {
          enabledCalls.push(enabled)
          return {
            data: Vue.ref(over.items === null ? undefined : { items: over.items ?? [branchSeat()], total: 1, limit: 5, read_only: 0 }),
            error: Vue.ref(over.error ?? null),
            isLoading: Vue.ref(false),
            refetch: vi.fn(),
          }
        },
      })
      return { state, enabled: Vue.unref(enabledCalls[0]!) }
    }

    for (const invalid of ['0', '-1', 'abc']) {
      const view = mountEdit({ branchId: invalid })
      expect(view.enabled).toBe(false)
      expect(view.state.pageError.value).toBeInstanceOf(ApiError)
      expect(view.state.pageError.value.status).toBe(404)
    }

    const missing = mountEdit({ branchId: '99', items: [branchSeat({ id: 7 })] })
    expect(missing.enabled).toBe(true)
    expect(missing.state.branch.value).toBeNull()
    expect(missing.state.pageError.value).toBeInstanceOf(ApiError)
    expect(missing.state.pageError.value.status).toBe(404)

    const readOnly = mountEdit({ readOnly: true })
    expect(readOnly.state.canCreate.value).toBe(false)
    expect(readOnly.enabled).toBe(false)

    const valid = mountEdit({ branchId: '7' })
    expect(valid.enabled).toBe(true)
    expect(valid.state.branch.value?.id).toBe(7)
    expect(valid.state.pageError.value).toBeNull()
  })

  it('branches.vue disables all 4 parent queries while rendering a branch edit sub-page', () => {
    const enabledStates: Record<string, boolean> = {}
    setupSfc(resolve(import.meta.dirname, '../../../../pages/settings/team/branches.vue'), {}, {
      ApiError,
      BranchPresetCard: {},
      BranchPolicyCard: {},
      BranchMembersCard: {},
      useRoute: () => ({ path: '/settings/team/branches/7/edit', query: {}, hash: '' }),
      useAccess: () => ({ can: () => true }),
      useMe: () => ({ me: Vue.ref({ id: 7, company: { id: 1 }, read_only: false }) }),
      useBranchSeats: (enabled: Vue.Ref<boolean>) => { enabledStates.seats = Vue.unref(enabled); return { data: Vue.ref(null), error: Vue.ref(null), isLoading: Vue.ref(false), refetch: vi.fn() } },
      useBranchPolicy: (enabled: Vue.Ref<boolean>) => { enabledStates.policy = Vue.unref(enabled); return { data: Vue.ref(undefined), error: Vue.ref(null), isLoading: Vue.ref(false), refetch: vi.fn() } },
      useMembershipBranches: (enabled: Vue.Ref<boolean>) => { enabledStates.branches = Vue.unref(enabled); return { data: Vue.ref(undefined), error: Vue.ref(null), isLoading: Vue.ref(false), refetch: vi.fn() } },
      useAdminRoles: (_params: unknown, enabled: Vue.Ref<boolean>) => { enabledStates.roles = Vue.unref(enabled); return { data: Vue.ref(undefined), error: Vue.ref(null), isLoading: Vue.ref(false), refetch: vi.fn() } },
    })
    expect(enabledStates).toEqual({ seats: false, policy: false, branches: false, roles: false })
  })
})
