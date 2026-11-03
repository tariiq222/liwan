import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

const filename = new URL('../meetings/[id].vue', import.meta.url).pathname
const template = parse(readFileSync(filename, 'utf8'), { filename }).descriptor.template?.content ?? ''

// The meeting record shows the inline confirm unless the pending action is «إنهاء» with completion gaps,
// which shows the completion review instead. «تأكيد» on a draft without a schedule or minutes must still ask.
function confirmCondition() {
  const tag = template.match(/<SharedInlineConfirm[\s\S]*?v-if="([^"]+)"/)
  if (!tag?.[1]) throw new Error('SharedInlineConfirm v-if not found')
  return tag[1]
}

function inlineConfirmVisible(action: string, completionGaps: string[]) {
  const pendingMeetingAction = { action }
  const meetingActionConfirm = { title: 'x' }
  return new Function('pendingMeetingAction', 'meetingActionConfirm', 'completionGaps', `return Boolean(${confirmCondition()})`)(
    pendingMeetingAction, meetingActionConfirm, completionGaps,
  )
}

describe('meeting record inline confirm visibility', () => {
  it('asks before confirming a draft even when it has no schedule or minutes yet', () => {
    expect(inlineConfirmVisible('confirm', ['schedule', 'minutes'])).toBe(true)
    expect(inlineConfirmVisible('confirm', [])).toBe(true)
  })

  it('shows the completion review instead of the confirm only for «إنهاء» with gaps', () => {
    expect(inlineConfirmVisible('complete', ['minutes'])).toBe(false)
    expect(inlineConfirmVisible('complete', [])).toBe(true)
    expect(inlineConfirmVisible('reopen', ['minutes'])).toBe(true)
  })
})
