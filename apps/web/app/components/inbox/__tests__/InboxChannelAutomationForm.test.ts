import { describe, expect, it, vi } from 'vitest'
import { TIKTOK_SURVEY_QUESTION_MAX, TIKTOK_WELCOME_MAX, automationToDraft, automationWrite } from '../../../composables/inbox/inboxAutomation'
import { mountScript } from './scriptHarness'

const filename = new URL('../InboxChannelAutomationForm.vue', import.meta.url)

// A stored automation whose survey question is longer than TikTok's 40-character card title: the contract still
// accepts it (up to 1024), so only the form's own TikTok check keeps such a survey from being saved and never sent.
const automation = (question: string) => ({
  welcome: { enabled: false, idle_days: 0, content: null },
  away: { enabled: false, repeat_hours: 4, content: null },
  csat: { enabled: true, question, good: 'ممتاز', neutral: 'مقبول', bad: 'سيئ' },
})

function mount(kind: 'whatsapp' | 'tiktok', auto: Record<string, unknown>) {
  const save = vi.fn()
  const { state } = mountScript(filename, {
    InboxAutoContentEditor: {},
    automationToDraft,
    automationWrite,
    TIKTOK_SURVEY_QUESTION_MAX,
    TIKTOK_WELCOME_MAX,
    useSaveInboxChannelAutomation: () => ({ mutate: save, isPending: false }),
  }, { channelId: 5, automation: auto, kind })
  return { state, save }
}

describe('InboxChannelAutomationForm', () => {
  it('refuses to save a TikTok survey whose question exceeds the card-title limit, and says why', () => {
    const { state, save } = mount('tiktok', automation('س'.repeat(TIKTOK_SURVEY_QUESTION_MAX + 5)))
    state.draft.csat.good = 'ممتازة' // a real edit, so only the too-long question can block the save
    expect(state.dirty).toBe(true)
    expect(state.csatTooLong).toBe(true)
    state.submit()
    expect(save).not.toHaveBeenCalled()
  })

  it('saves the same survey on WhatsApp, which carries no card-title limit', () => {
    const { state, save } = mount('whatsapp', automation('س'.repeat(TIKTOK_SURVEY_QUESTION_MAX + 5)))
    state.draft.csat.good = 'ممتازة'
    expect(state.csatTooLong).toBe(false)
    state.submit()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![0]).toMatchObject({ csat: { enabled: true, question: 'س'.repeat(TIKTOK_SURVEY_QUESTION_MAX + 5) } })
  })

  it('saves a TikTok survey whose question fits the card title', () => {
    const { state, save } = mount('tiktok', automation('كيف كانت تجربتك معنا؟'))
    state.draft.csat.good = 'ممتازة'
    expect(state.csatTooLong).toBe(false)
    state.submit()
    expect(save).toHaveBeenCalledTimes(1)
  })
})
