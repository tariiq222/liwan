import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { MeetingDetail } from '@liwan/contracts'
import { ApiError } from '../useApi'

const meetingAction = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: { value: false } }))
const deleteMeeting = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: { value: false } }))
vi.mock('../useMeetings', () => ({ useMeetingAction: () => meetingAction, useDeleteMeeting: () => deleteMeeting }))

const toastAdd = vi.fn()
const globals = globalThis as typeof globalThis & { useI18n: () => unknown; useToast: () => unknown }

function setup(overrides: Partial<MeetingDetail> = {}, hydrated = true, onDeleted?: () => unknown) {
  return import('../useMeetingTransitions').then(({ useMeetingTransitions }) => useMeetingTransitions({
    meetingId: ref(7),
    meeting: ref({ id: 7, name: 'Review', series_id: null, ...overrides } as MeetingDetail),
    hydrated: ref(hydrated),
    onDeleted,
  }))
}

describe('useMeetingTransitions', () => {
  beforeEach(() => {
    meetingAction.mutateAsync.mockReset().mockResolvedValue({})
    meetingAction.isPending.value = false
    deleteMeeting.mutateAsync.mockReset().mockResolvedValue(undefined)
    deleteMeeting.isPending.value = false
    toastAdd.mockReset()
    globals.useI18n = () => ({ t: (key: string) => key })
    globals.useToast = () => ({ add: toastAdd })
  })

  it('confirms at once without asking', async () => {
    const transitions = await setup()
    transitions.requestMeetingAction('confirm')
    await vi.waitFor(() => expect(meetingAction.mutateAsync).toHaveBeenCalledWith({ id: 7, action: 'confirm', body: undefined }))
    expect(transitions.pendingMeetingAction.value).toBeNull()
  })

  it.each([
    ['complete', 'meetingsUx.confirmComplete', 'meetingsUi.complete'],
    ['reopen', 'meetingsUx.confirmReopen', 'meetingsUi.reopen'],
  ] as const)('%s asks inline with a warning, then runs on confirmation', async (action, title, label) => {
    const transitions = await setup()
    transitions.requestMeetingAction(action)
    expect(meetingAction.mutateAsync).not.toHaveBeenCalled()
    expect(transitions.pendingMeetingAction.value).toEqual({ action })
    expect(transitions.meetingActionConfirm.value).toEqual({ color: 'warning', title, label })
    await transitions.confirmMeetingAction()
    expect(meetingAction.mutateAsync).toHaveBeenCalledWith({ id: 7, action, body: undefined })
    expect(transitions.pendingMeetingAction.value).toBeNull()
  })

  it('cancelling a series meeting defaults to this occurrence and sends the scope', async () => {
    const transitions = await setup({ series_id: 3 })
    transitions.requestMeetingAction('cancel')
    expect(transitions.pendingMeetingAction.value).toEqual({ action: 'cancel', scope: 'this' })
    expect(transitions.meetingActionConfirm.value?.color).toBe('error')
    transitions.pendingMeetingAction.value = { action: 'cancel', scope: 'this_and_following' }
    await transitions.confirmMeetingAction()
    expect(meetingAction.mutateAsync).toHaveBeenCalledWith({ id: 7, action: 'cancel', body: { scope: 'this_and_following' } })
  })

  it('cancelling a standalone meeting sends no scope', async () => {
    const transitions = await setup()
    transitions.requestMeetingAction('cancel')
    expect(transitions.pendingMeetingAction.value).toEqual({ action: 'cancel' })
    await transitions.confirmMeetingAction()
    expect(meetingAction.mutateAsync).toHaveBeenCalledWith({ id: 7, action: 'cancel', body: undefined })
  })

  it('deleting a draft asks inline with an error confirm, deletes on confirmation and then leaves the page', async () => {
    const onDeleted = vi.fn()
    const transitions = await setup({ state: 'draft' }, true, onDeleted)
    transitions.requestMeetingAction('delete')
    expect(deleteMeeting.mutateAsync).not.toHaveBeenCalled()
    expect(transitions.pendingMeetingAction.value).toEqual({ action: 'delete' })
    expect(transitions.meetingActionConfirm.value).toEqual({ color: 'error', title: 'meetingsUx.confirmDeleteMeeting', label: 'meetingsUx.deleteMeetingConfirmLabel' })
    await transitions.confirmMeetingAction()
    expect(deleteMeeting.mutateAsync).toHaveBeenCalledWith(7)
    expect(meetingAction.mutateAsync).not.toHaveBeenCalled()
    expect(onDeleted).toHaveBeenCalledOnce()
    expect(transitions.pendingMeetingAction.value).toBeNull()
  })

  it('keeps a refused delete (409, not a draft) on the page with the server message', async () => {
    deleteMeeting.mutateAsync.mockRejectedValue(new ApiError(409, 'conflict', 'only a draft meeting can be deleted'))
    const onDeleted = vi.fn()
    const transitions = await setup({ state: 'confirmed' }, true, onDeleted)
    transitions.requestMeetingAction('delete')
    await transitions.confirmMeetingAction()
    expect(transitions.actionError.value).toBe('only a draft meeting can be deleted')
    expect(onDeleted).not.toHaveBeenCalled()
    expect(transitions.pendingMeetingAction.value).toEqual({ action: 'delete' })
  })

  it('does nothing before hydration or while a transition is pending', async () => {
    const early = await setup({}, false)
    early.requestMeetingAction('confirm')
    early.requestMeetingAction('complete')
    expect(early.pendingMeetingAction.value).toBeNull()
    meetingAction.isPending.value = true
    const busy = await setup()
    busy.requestMeetingAction('reopen')
    expect(busy.pendingMeetingAction.value).toBeNull()
    expect(meetingAction.mutateAsync).not.toHaveBeenCalled()
  })

  it('keeps a failed transition available for retry with an inline error', async () => {
    meetingAction.mutateAsync.mockRejectedValue(new ApiError(422, 'invalid', 'لا يمكن الإنهاء'))
    const transitions = await setup()
    transitions.requestMeetingAction('complete')
    await transitions.confirmMeetingAction()
    expect(transitions.actionError.value).toBe('لا يمكن الإنهاء')
    expect(transitions.pendingMeetingAction.value).toEqual({ action: 'complete' })
  })

  it('falls back to the generic message for other errors', async () => {
    meetingAction.mutateAsync.mockRejectedValue(new Error('boom'))
    const transitions = await setup()
    transitions.requestMeetingAction('complete')
    await transitions.confirmMeetingAction()
    expect(transitions.actionError.value).toBe('errors.generic')
  })
})
