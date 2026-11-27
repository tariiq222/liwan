import { readFileSync } from 'node:fs'
import { InboxCannedReplyWriteSchema, InboxDepartmentWriteSchema, type InboxCannedReply, type InboxDepartment, type InboxTag } from '@liwan/contracts'
import { returnToQuery, safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { committedName } from '@liwan/ui/app/utils/settingsListName'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../composables/useApi'
import { saveErrorMessage } from '../../../utils/formFeedback'
import { mountScript } from './scriptHarness'

const tagsFile = new URL('../InboxTagsSection.vue', import.meta.url)
const departmentsFile = new URL('../InboxDepartmentsSection.vue', import.meta.url)
const departmentFormFile = new URL('../InboxDepartmentForm.vue', import.meta.url)
const departmentHoursFile = new URL('../InboxDepartmentHours.vue', import.meta.url)
const departmentEditPageFile = new URL('../../../pages/settings/apps/inbox/departments/[id]/edit.vue', import.meta.url)
const cannedFile = new URL('../InboxCannedRepliesSection.vue', import.meta.url)
const cannedFormFile = new URL('../InboxCannedReplyForm.vue', import.meta.url)
const cannedEditPageFile = new URL('../../../pages/settings/apps/inbox/canned-replies/[id]/edit.vue', import.meta.url)
const inboxSettingsPageFile = new URL('../../../pages/settings/apps/inbox.vue', import.meta.url)

describe('InboxTagsSection', () => {
  it('uses SharedSettingsList with inline add/rename and no toast or custom form', () => {
    const source = readFileSync(tagsFile, 'utf8')
    expect(source).toContain('<SharedSettingsList')
    expect(source).toContain('<SharedInlineConfirm')
    expect(source).toContain('committedName')
    expect(source).not.toContain('useToast')
    expect(source).not.toContain('<form')
  })

  it('adds, renames, restores empty renames, surfaces errors in-card and deletes on confirmation', async () => {
    const tags: InboxTag[] = [{ id: 1, name: 'شكوى' }]
    const save = vi.fn().mockResolvedValue({ id: 2, name: 'حجز' })
    const remove = vi.fn().mockResolvedValue(undefined)
    const { state, stop } = mountScript(tagsFile, {
      committedName,
      saveErrorMessage,
      useInboxTags: () => ({ data: Vue.ref({ items: tags, total: tags.length }), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
      useSaveInboxTag: () => ({ mutateAsync: save }),
      useDeleteInboxTag: () => ({ mutateAsync: remove, isPending: Vue.ref(false) }),
    }, {})

    try {
      state.newName = '  حجز  '
      await state.addTag()
      expect(save).toHaveBeenCalledWith({ body: { name: 'حجز' } })
      expect(state.newName).toBe('')

      // Emptying a row restores its stored name and sends no write.
      const emptyInput = { value: '   ' } as HTMLInputElement
      await state.commitRename(tags[0]!, { target: emptyInput } as unknown as Event)
      expect(emptyInput.value).toBe('شكوى')
      expect(save).toHaveBeenCalledTimes(1)

      // A changed name patches the tag; a failure restores the input and sets errorMessage.
      save.mockRejectedValueOnce(new ApiError(422, 'invalid', 'duplicate tag'))
      const renameInput = { value: 'متابعة' } as HTMLInputElement
      await state.commitRename(tags[0]!, { target: renameInput } as unknown as Event)
      expect(save).toHaveBeenLastCalledWith({ id: 1, body: { name: 'متابعة' } })
      expect(renameInput.value).toBe('شكوى')
      expect(state.errorMessage).toBe('duplicate tag')

      // Delete runs only after inline confirmation is opened and confirmed.
      state.deleting = tags[0]!
      await state.confirmDelete()
      expect(remove).toHaveBeenCalledWith(1)
      expect(state.deleting).toBeNull()
      expect(state.errorMessage).toBe('')
    } finally {
      stop()
    }
  })

  it('locks other row mutations while a tag rename is in flight so busyId cannot be clobbered', async () => {
    const tags: InboxTag[] = [{ id: 1, name: 'شكوى' }, { id: 2, name: 'متابعة' }]
    let resolveFirst!: (value: InboxTag) => void
    const save = vi.fn().mockImplementationOnce(() => new Promise<InboxTag>((resolve) => { resolveFirst = resolve }))
    const remove = vi.fn().mockResolvedValue(undefined)
    const { state, stop } = mountScript(tagsFile, {
      committedName,
      saveErrorMessage,
      useInboxTags: () => ({ data: Vue.ref({ items: tags, total: tags.length }), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
      useSaveInboxTag: () => ({ mutateAsync: save }),
      useDeleteInboxTag: () => ({ mutateAsync: remove, isPending: Vue.ref(false) }),
    }, {})

    try {
      const firstRename = state.commitRename(tags[0]!, { target: { value: 'استفسار' } } as unknown as Event)
      expect(state.busyId).toBe(1)
      expect(state.locked).toBe(true)

      await state.commitRename(tags[1]!, { target: { value: 'آخر' } } as unknown as Event)
      expect(save).toHaveBeenCalledTimes(1)
      expect(state.busyId).toBe(1)

      state.deleting = tags[1]!
      await state.confirmDelete()
      expect(remove).not.toHaveBeenCalled()
      expect(state.busyId).toBe(1)

      resolveFirst({ id: 1, name: 'استفسار' })
      await firstRename
      expect(state.busyId).toBeNull()
      expect(state.locked).toBe(false)
    } finally {
      stop()
    }
  })
})

describe('InboxDepartmentsSection and InboxCannedRepliesSection', () => {
  it('have no inline form or toast and link create/edit through routes with SharedRowActions and SharedInlineConfirm', () => {
    const deptSource = readFileSync(departmentsFile, 'utf8')
    expect(deptSource).not.toContain('<form')
    expect(deptSource).not.toContain('useToast')
    expect(deptSource).toContain('/settings/apps/inbox/departments/new')
    expect(deptSource).toContain('/settings/apps/inbox/departments/${department.id}/edit')
    expect(deptSource).toContain('<SharedRowActions')
    expect(deptSource).toContain('<SharedInlineConfirm')

    const cannedSource = readFileSync(cannedFile, 'utf8')
    expect(cannedSource).not.toContain('<form')
    expect(cannedSource).not.toContain('useToast')
    expect(cannedSource).toContain('/settings/apps/inbox/canned-replies/new')
    expect(cannedSource).toContain('/settings/apps/inbox/canned-replies/${reply.id}/edit')
    expect(cannedSource).toContain('<SharedRowActions')
    expect(cannedSource).toContain('<SharedInlineConfirm')
  })

  it('builds edit and delete row actions with returnTo and surfaces delete errors in-card', async () => {
    const department: InboxDepartment = { id: 4, name: 'المبيعات', members: [{ id: 10, name: 'سارة' }] }
    const removeDept = vi.fn().mockRejectedValueOnce(new ApiError(409, 'conflict', 'in use')).mockResolvedValueOnce(undefined)
    const deptMount = mountScript(departmentsFile, {
      returnToQuery,
      saveErrorMessage,
      useRoute: () => ({ fullPath: '/settings/apps/inbox?tab=basics#departments' }),
      useInboxDepartments: () => ({ data: Vue.ref({ items: [department], total: 1 }), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
      useDeleteInboxDepartment: () => ({ mutateAsync: removeDept, isPending: Vue.ref(false) }),
    }, {})

    const reply: InboxCannedReply = { id: 9, shortcut: 'welcome', body: 'مرحبًا بك' }
    const removeReply = vi.fn().mockResolvedValue(undefined)
    const cannedMount = mountScript(cannedFile, {
      returnToQuery,
      saveErrorMessage,
      useRoute: () => ({ fullPath: '/settings/apps/inbox?tab=replies#canned-replies' }),
      useInboxCannedReplies: () => ({ data: Vue.ref({ items: [reply], total: 1 }), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
      useDeleteInboxCannedReply: () => ({ mutateAsync: removeReply, isPending: Vue.ref(false) }),
    }, {})

    try {
      const deptActions = deptMount.state.rowActions(department)
      expect(deptActions[0]?.to).toEqual({
        path: '/settings/apps/inbox/departments/4/edit',
        query: { returnTo: '/settings/apps/inbox?tab=basics#departments' },
      })
      expect(deptActions[1]?.destructive).toBe(true)
      deptActions[1]?.onSelect?.()
      expect(deptMount.state.deleting).toEqual(department)
      await deptMount.state.confirmDelete()
      expect(deptMount.state.deleteError).toBe('in use')
      await deptMount.state.confirmDelete()
      expect(deptMount.state.deleting).toBeNull()
      expect(deptMount.state.deleteError).toBe('')

      const replyActions = cannedMount.state.rowActions(reply)
      expect(replyActions[0]?.to).toEqual({
        path: '/settings/apps/inbox/canned-replies/9/edit',
        query: { returnTo: '/settings/apps/inbox?tab=replies#canned-replies' },
      })
      expect(replyActions[1]?.destructive).toBe(true)
      replyActions[1]?.onSelect?.()
      await cannedMount.state.confirmDelete()
      expect(removeReply).toHaveBeenCalledWith(9)
      expect(cannedMount.state.deleting).toBeNull()
    } finally {
      deptMount.stop()
      cannedMount.stop()
    }
  })
})

describe('InboxDepartmentForm and InboxCannedReplyForm', () => {
  it('use SharedUnsavedChanges and SharedFormActions without toasts', () => {
    for (const file of [departmentFormFile, cannedFormFile]) {
      const source = readFileSync(file, 'utf8')
      expect(source).toContain('<SharedUnsavedChanges :dirty="dirty"')
      expect(source).toContain('<SharedFormActions>')
      expect(source).not.toContain('useToast')
    }
  })

  it('InboxDepartmentForm validates, tracks dirty state and clears dirty before emitting done', async () => {
    const save = vi.fn().mockResolvedValue({ id: 5, name: 'الدعم', members: [] })
    const { state, emitted, stop } = mountScript(departmentFormFile, {
      InboxDepartmentWriteSchema,
      saveErrorMessage,
      useSaveInboxDepartment: () => ({ mutateAsync: save, isPending: Vue.ref(false) }),
    }, {})

    try {
      expect(state.dirty).toBe(false)
      await state.submit()
      expect(save).not.toHaveBeenCalled()
      expect(state.attempted).toBe(true)

      state.name = '  الدعم  '
      state.setMembers([7, 8])
      expect(state.dirty).toBe(true)

      await state.submit()
      expect(save).toHaveBeenCalledWith({ id: undefined, body: { name: 'الدعم', member_ids: [7, 8] } })
      expect(state.dirty).toBe(false)
      expect(emitted).toContainEqual(['done', undefined])
    } finally {
      stop()
    }
  })

  it('InboxCannedReplyForm strips a leading slash, validates, and surfaces server failures', async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError(422, 'invalid', 'shortcut taken')).mockResolvedValueOnce({ id: 9, shortcut: 'hi', body: 'أهلًا' })
    const { state, emitted, stop } = mountScript(cannedFormFile, {
      InboxCannedReplyWriteSchema,
      saveErrorMessage,
      useSaveInboxCannedReply: () => ({ mutateAsync: save, isPending: Vue.ref(false) }),
    }, { reply: { id: 9, shortcut: 'old', body: 'قديم' } })

    try {
      expect(state.dirty).toBe(false)
      state.shortcut = ' /hi '
      state.body = ' أهلًا '
      expect(state.dirty).toBe(true)

      await state.submit()
      expect(state.failure).toBeInstanceOf(ApiError)
      expect(emitted).toEqual([])
      expect(state.dirty).toBe(true)

      await state.submit()
      expect(save).toHaveBeenLastCalledWith({ id: 9, body: { shortcut: 'hi', body: 'أهلًا' } })
      expect(state.dirty).toBe(false)
      expect(emitted).toContainEqual(['done', undefined])
    } finally {
      stop()
    }
  })
})

describe('inbox settings page shell', () => {
  it('renders SharedForbiddenState when no parts are visible and overlays /new create panels while routing /edit as sub-pages', () => {
    const source = readFileSync(inboxSettingsPageFile, 'utf8')
    expect(source).toContain('<SharedForbiddenState v-if="!parts.length"')

    const route = Vue.reactive({ path: '/settings/apps/inbox' })
    const stub = {}
    const { state, stop } = mountScript(inboxSettingsPageFile, {
      InboxCampaignSettingsCard: stub,
      InboxAgentsSection: stub,
      InboxAutoMessagesSection: stub,
      InboxCannedRepliesSection: stub,
      InboxChannelsSection: stub,
      InboxDepartmentsSection: stub,
      InboxPolicyCard: stub,
      InboxPresets: stub,
      InboxTagsSection: stub,
      useRoute: () => route,
      useSettingsPage: () => ({ parts: Vue.ref([]), shows: () => false, tabItems: Vue.ref([]), activeTab: Vue.ref('basics') }),
      useInboxCampaignsEnabled: () => Vue.ref(false),
      useInboxSettings: () => ({ data: Vue.ref(null), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
      useInboxCampaignSettings: () => ({ data: Vue.ref(null), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
    }, {})

    try {
      for (const overlaid of ['/settings/apps/inbox', '/settings/apps/inbox/channels/new', '/settings/apps/inbox/departments/new', '/settings/apps/inbox/canned-replies/new']) {
        route.path = overlaid
        expect(state.isSubPage, overlaid).toBe(false)
      }
      for (const subPage of ['/settings/apps/inbox/channels/4', '/settings/apps/inbox/departments/4/edit', '/settings/apps/inbox/canned-replies/9/edit']) {
        route.path = subPage
        expect(state.isSubPage, subPage).toBe(true)
      }
    } finally {
      stop()
    }
  })

  it('gates useInboxCannedReplies on manage capability and valid id in canned-replies/[id]/edit.vue', () => {
    const route = Vue.reactive({ params: { id: 'abc' }, query: {} })
    const allowed = Vue.ref(false)
    const enabledFns: Array<() => boolean> = []
    const { stop } = mountScript(cannedEditPageFile, {
      safeReturnTo,
      InboxCannedReplyForm: {},
      useRoute: () => route,
      useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
      useAccess: () => ({ can: (cap: string) => cap === 'inbox.settings.manage' && allowed.value }),
      useInboxCannedReplies: (enabled?: () => boolean) => {
        if (enabled) enabledFns.push(enabled)
        return { data: Vue.ref(null), isPending: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }
      },
    }, {})

    try {
      expect(enabledFns).toHaveLength(1)
      expect(enabledFns[0]!()).toBe(false)
      route.params.id = '9'
      expect(enabledFns[0]!()).toBe(false)
      allowed.value = true
      expect(enabledFns[0]!()).toBe(true)
      route.params.id = '0'
      expect(enabledFns[0]!()).toBe(false)
    } finally {
      stop()
    }
  })

  it('renders InboxDepartmentHours cleanly inside departments/[id]/edit.vue without a redundant top divider or duplicated title', () => {
    const hoursSource = readFileSync(departmentHoursFile, 'utf8')
    const editSource = readFileSync(departmentEditPageFile, 'utf8')
    expect(hoursSource).not.toContain('border-t border-default pt-3')
    expect(hoursSource).toContain('<SharedSettingRow')
    expect(editSource).toContain("t('inbox.automation.hours.title')")
    expect(editSource).not.toContain("t('inbox.automation.hours.ownHours')")
  })
})
