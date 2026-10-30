import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the schedule stays on the timeline template', () => {
  it('the page is a hide-header timeline frame and the Gantt has no header of its own', () => {
    const page = read('pages/projects/[id]/schedule.vue')
    for (const needle of ['<SharedTimelineFrame', 'hide-header', 'scrollPage', 'project-header-create']) expect(page).toContain(needle)
    expect(page).not.toContain('<SharedPageHeader')
    const gantt = read('components/pmo/projects/schedule/ScheduleGantt.vue')
    for (const gone of ['embedded', "emit('update:scale'", 'projects.schedule.timeline']) expect(gantt).not.toContain(gone)
    expect(gantt).toContain('defineExpose')
  })
})

describe('the Gantt milestone dots', () => {
  it('colour each dot from the milestone state, not one warning tone', () => {
    const gantt = read('components/pmo/projects/schedule/ScheduleGantt.vue')
    expect(gantt).toContain('MILESTONE_DOT_CLASS[milestoneBadge(milestone).tone]')
    expect(gantt).not.toMatch(/liwan-status-dot-warning[^"]*"\s*:style="markerPosition\(milestone/)
    for (const tone of ['success', 'info', 'destructive']) expect(gantt).toMatch(new RegExp(`${tone}: '(liwan-status-dot-success|bg-\\(--status-(info|danger)\\))'`))
  })
})
