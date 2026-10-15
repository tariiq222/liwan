import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { MeetingDetail } from '@nasq/contracts'
import { ApiError } from '../useApi'

const meetingAction = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: { value: false } }))
vi.mock('../useMeetings', () => ({ useMeetingAction: () => meetingAction }))

const toastAdd = vi.fn()
const globals = globalThis as typeof globalThis & { useI18n: () => unknown; useToast: () => unknown }

function setup(overrides: Partial<MeetingDetail> = {}, hydrated = true) {
  return import('../useMeetingTransitions').then(({ useMeetingTransitions }) => useMeetingTransitions({
    meetingId: ref(7),
    meeting: ref({ id: 7, name: 'Review', series_id: null, ...overrides } as MeetingDetail),
    hydrated: ref(hydrated),
  }))
}

describe('useMeetingTransitions', () => {
  beforeEach(() => {
    meetingAction.mutateAsync.mockReset().mockResolvedValue({})
    meetingAction.isPending.value = false
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

  it('shows the API error message in a toast and clears the pending action', async () => {
    meetingAction.mutateAsync.mockRejectedValue(new ApiError(422, 'invalid', 'لا يمكن الإنهاء'))
    const transitions = await setup()
    transitions.requestMeetingAction('complete')
    await transitions.confirmMeetingAction()
    expect(toastAdd).toHaveBeenCalledWith({ title: 'لا يمكن الإنهاء', color: 'error' })
    expect(transitions.pendingMeetingAction.value).toBeNull()
  })

  it('falls back to the generic message for other errors', async () => {
    meetingAction.mutateAsync.mockRejectedValue(new Error('boom'))
    const transitions = await setup()
    transitions.requestMeetingAction('complete')
    await transitions.confirmMeetingAction()
    expect(toastAdd).toHaveBeenCalledWith({ title: 'errors.generic', color: 'error' })
  })
})
