import { computed, ref, type Ref } from 'vue'
import type { MeetingDetail } from '@nasq/contracts'
import { ApiError } from './useApi'
import { useMeetingAction } from './useMeetings'

type MeetingAction = 'confirm' | 'complete' | 'reopen' | 'cancel'
type MeetingActionScope = 'this' | 'this_and_following'
type PendingMeetingAction = { action: MeetingAction; scope?: MeetingActionScope }

/**
 * Meeting state transitions: confirm runs at once, the others ask inline first, and cancelling a
 * series meeting asks which occurrences it applies to. The server confirms every transition.
 */
export function useMeetingTransitions({ meetingId, meeting, hydrated }: {
  meetingId: Ref<number | null>
  meeting: Ref<MeetingDetail | undefined>
  hydrated: Ref<boolean>
}) {
  const { t } = useI18n()
  const { mutateAsync: runMeeting, isPending: transitioning } = useMeetingAction()
  const actionError = ref('')
  const pendingMeetingAction = ref<PendingMeetingAction | null>(null)

  const meetingActionConfirm = computed(() => {
    const pending = pendingMeetingAction.value
    if (!pending || !meeting.value) return null
    if (pending.action === 'complete') return { color: 'warning' as const, title: t('meetingsUx.confirmComplete'), label: t('meetingsUi.complete') }
    if (pending.action === 'reopen') return { color: 'warning' as const, title: t('meetingsUx.confirmReopen'), label: t('meetingsUi.reopen') }
    return {
      color: 'error' as const,
      title: t('meetingsUx.confirmMeetingAction', { name: meeting.value.name, scope: pending.scope === 'this_and_following' ? t('meetingsUi.scopeFollowing') : t('meetingsUi.scopeThis') }),
      label: t('meetingsUi.confirm'),
    }
  })

  function requestMeetingAction(action: MeetingAction) {
    if (!hydrated.value || transitioning.value) return
    if (action === 'confirm') void executeMeetingAction({ action })
    else pendingMeetingAction.value = action === 'cancel' && meeting.value?.series_id
      ? { action, scope: 'this' }
      : { action }
  }

  async function executeMeetingAction(pending: PendingMeetingAction) {
    if (!hydrated.value || transitioning.value || !meetingId.value) return
    actionError.value = ''
    try {
      await runMeeting({ id: meetingId.value, action: pending.action, body: pending.scope ? { scope: pending.scope } : undefined })
      pendingMeetingAction.value = null
    } catch (error) {
      actionError.value = error instanceof ApiError ? error.message : t('errors.generic')
    }
  }

  async function confirmMeetingAction() {
    const pending = pendingMeetingAction.value
    if (pending) await executeMeetingAction(pending)
  }

  return { actionError, pendingMeetingAction, meetingActionConfirm, requestMeetingAction, confirmMeetingAction, transitioning }
}
