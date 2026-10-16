import { expect, it } from 'vitest'
import { MeetingFollowupListSchema } from '..'
it('requires source identity and execution state in the existing recommendation list shape', () => {
  const row = { id: 1, name: 'قرار', deadline: null, priority: '0', state: 'open', responsible: null, task_id: null, result: '', can_update_execution: false, can_edit_decision: false, execution_state: 'done', meeting_id: 2, meeting_name: 'اجتماع' }
  expect(MeetingFollowupListSchema.parse({ items: [row], total: 27 }).items[0]?.execution_state).toBe('done')
  expect(MeetingFollowupListSchema.safeParse({ items: [{ ...row, meeting_id: undefined }], total: 1 }).success).toBe(false)
})
