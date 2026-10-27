import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The meetings and chat pages stay on their templates. This is a source guard, not a behaviour test: the behaviour
// is pinned by e2e/tasmim6-6c-*.spec.ts.
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the meetings pages stay on their templates', () => {
  it.each([
    ['pages/meetings/index.vue', ['<SharedListPage', '<SharedDataTable', 'create-test-id="meeting-new"']],
    ['pages/meetings/series.vue', ['<SharedListPage', '<SharedDataTable', 'create-test-id="meeting-series-new"']],
    ['pages/meetings/calendar.vue', ['<SharedTimelineFrame']],
    // The record's five tabs are a custom overflow-aware strip (MeetingRecordTabs), not SharedRouteTabs.
    ['pages/meetings/[id].vue', ['<SharedRecordPage', '<MeetingRecordTabs', '<SharedPropertiesPanel', '<SharedRecordSection']],
    ['components/meetings/MeetingRecordTabs.vue', ['data-testid="meeting-tabs"']],
    ['pages/meetings/series/[id].vue', ['<SharedRecordPage', '<SharedRouteTabs', '<SharedPropertiesPanel']],
    ['pages/meetings/[id]/print.vue', ['<SharedStandalonePage', 'variant="print"', 'webvue-print-landscape']],
  ])('%s uses its template', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
    expect(source, 'no hand-made page header').not.toContain('<SharedPageHeader')
    expect(source, 'no hand-made page container').not.toContain('<SharedPageContainer')
  })

  it('the resolutions and attachments tabs stay mounted behind v-show', () => {
    const source = read('pages/meetings/[id].vue')
    expect(source).toMatch(/<div\s+v-show="activeTab === 'resolutions'"[\s\S]*?<MeetingResolutionsTab/)
    expect(source).toMatch(/<MeetingAttachmentsTab\s+v-show="activeTab === 'attachments'"/)
  })

  it('the print page has no scoped style and no UTabs, UTable or UCard-only tabs remain on the record pages', () => {
    expect(read('pages/meetings/[id]/print.vue')).not.toContain('<style')
    for (const file of ['pages/meetings/[id].vue', 'pages/meetings/series/[id].vue']) expect(read(file), file).not.toMatch(/<UTabs\s+:model-value="activeTab"/)
    for (const file of ['pages/meetings/index.vue', 'pages/meetings/series.vue', 'components/meetings/MeetingTimeline.vue']) expect(read(file), file).not.toContain('<UTable')
  })

  it('the history lists use the shared states', () => {
    for (const file of ['components/meetings/MeetingEventList.vue', 'components/meetings/MeetingVersionList.vue']) {
      const source = read(file)
      expect(source, file).toContain('<SharedPageState')
      expect(source, file).not.toContain('<USkeleton')
    }
  })
})

describe('chat stays on the conversation layout', () => {
  it('the workspace renders the layout and keeps chat-thread on the messages column', () => {
    const source = read('components/chat/ChatWorkspace.vue')
    expect(source).toContain('<SharedConversationLayout')
    expect(source).toContain('data-testid="chat-thread"')
    expect(source).toContain('data-testid="chat-thread-header"')
    expect(source).not.toContain('<SharedPageContainer')
  })

  it('the thread and the info panel are one page; the old two pages are gone', () => {
    expect(existsSync(resolve(app, 'pages/chat/[id]/[[panel]].vue'))).toBe(true)
    expect(existsSync(resolve(app, 'pages/chat/[id]/index.vue'))).toBe(false)
    expect(existsSync(resolve(app, 'pages/chat/[id]/info.vue'))).toBe(false)
  })

  it('the composer keeps its draft as a model and derives the mentions from the text at send time', () => {
    const source = read('components/chat/MessageComposer.vue')
    expect(source).toContain("defineModel<string>('draft'")
    expect(source).not.toContain('mentionIds\'')
    expect(source).toContain('mentionIdsInText(body')
  })
})
