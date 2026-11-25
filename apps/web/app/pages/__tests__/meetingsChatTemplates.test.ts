import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The meetings and chat pages stay on their templates. This is a source guard, not a behaviour test: the behaviour
// is pinned by e2e/tasmim6-6c-*.spec.ts.
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the meetings pages stay on their templates', () => {
  it.each([
    ['pages/meetings/index.vue', ['<SharedListPage', '<template #kpis>', 'data-testid="meeting-kpi-strip"', '<SharedDataTable', 'create-test-id="meeting-new"']],
    ['pages/meetings/series.vue', ['<SharedListPage', '<template #kpis>', 'data-testid="meeting-series-kpi-strip"', '<SharedDataTable', 'create-test-id="meeting-series-new"']],
    ['pages/meetings/follow-up.vue', ['<SharedListPage', '<template #kpis>', 'data-testid="meeting-followup-kpi-strip"', '<SharedDataTable']],
    ['pages/meetings/calendar.vue', ['<SharedTimelineFrame', '<FilterBar embedded', '#scope', 'data-testid="meeting-scope"']],
    // The record's five tabs are the shared route tabs (one line, scrolling, with the log tab after a separator).
    ['pages/meetings/[id].vue', ['<SharedRecordWorkspace', '<SharedRecordHero', 'data-testid="meeting-hero"', '<SharedRouteTabs data-testid="meeting-tabs"', 'separatorBefore', 'data-testid="meeting-properties"', '<SharedRecordSection']],
    ['pages/meetings/series/[id].vue', ['<SharedRecordPage', '<SharedRouteTabs data-testid="meeting-series-tabs"', '#aside', '<SharedPropertiesPanel']],
    ['pages/meetings/[id]/print.vue', ['<SharedStandalonePage', 'variant="print"', 'liwan-print-landscape']],
  ])('%s uses its template', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
    expect(source, 'no hand-made page header').not.toContain('<SharedPageHeader')
    expect(source, 'no hand-made page container').not.toContain('<SharedPageContainer')
  })

  it('the meetings list pages rely on #kpis instead of an explicit kpi-toggle prop', () => {
    for (const file of ['pages/meetings/index.vue', 'pages/meetings/series.vue', 'pages/meetings/follow-up.vue']) {
      expect(read(file), file).not.toMatch(/<SharedListPage[^>]*\bkpi-toggle\b/)
    }
  })

  it('the series record keeps the properties panel in the aside and nothing in the summary slot', () => {
    const source = read('pages/meetings/series/[id].vue')
    const summarySlot = source.match(/<template[^>]*#summary>[\s\S]*?<\/template>/)?.[0] ?? ''
    const asideSlot = source.match(/<template[^>]*#aside>[\s\S]*?<\/template>/)?.[0] ?? ''
    expect(summarySlot).not.toContain('<SharedPropertiesPanel')
    expect(source).not.toContain('#summary')
    expect(asideSlot).toContain('<SharedPropertiesPanel')
  })

  it('the calendar create button keeps the C shortcut and waits for hydration', () => {
    const source = read('pages/meetings/calendar.vue')
    const button = source.match(/<UButton[^>]*data-testid="meeting-calendar-new"[^>]*\/>/)?.[0] ?? ''
    expect(button).toContain('data-shortcut-create')
    expect(button).toContain('aria-keyshortcuts="c"')
    expect(button).toContain(':disabled="!hydrated"')
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

describe('chat stays on the conversation frame', () => {
  it('the workspace draws the page header and fills the shared conversation frame, and keeps chat-thread on the messages column', () => {
    const source = read('components/chat/ChatWorkspace.vue')
    expect(source).toContain('<SharedPageHeader')
    expect(source, 'compact inside an open conversation').toContain(':compact="hasSelection"')
    expect(source).toContain('<SharedConversationLayout')
    expect(source).not.toContain('data-template="conversation-layout"')
    expect(source).toContain('data-testid="chat-thread"')
    expect(source).toContain('data-testid="chat-thread-header"')
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
