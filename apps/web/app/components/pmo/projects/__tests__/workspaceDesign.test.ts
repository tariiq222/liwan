import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const app = resolve(import.meta.dirname, '../../../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')
const pmo = (name: string) => read(`components/pmo/projects/${name}`)

describe('project workspace design contract', () => {
  it('draws inner blocks with SharedSubCard, never a hand-built box', () => {
    const boxes = /rounded-md (?:border(?: border-default)? p-[23]|bg-elevated\/50 p-3)/
    for (const file of ['ProjectCharterDisplay.vue', 'ProjectCharterFields.vue', 'ProjectCharterRows.vue', 'FollowerList.vue', 'StageListEditor.vue']) {
      expect(pmo(file), file).not.toMatch(boxes)
    }
    expect(pmo('StageListEditor.vue')).toContain('<SharedSubCard')
    expect(pmo('FollowerList.vue')).toContain('<SharedSubCard')
    expect(pmo('ProjectCharterRows.vue')).toContain('<SharedSubCard')
  })

  it('builds the overview from compact metric tiles and the shared progress bar', () => {
    const overview = pmo('ProjectOverview.vue')
    expect(overview).not.toContain('metricGridClass')
    expect(overview).not.toContain('<UProgress')
    expect(overview).toContain('density="compact"')
    expect(overview).toContain('emphasis')
    expect(overview).toContain('<SharedProgress')
    expect(read('pages/projects/[id]/index.vue')).toContain('width="full"')
    expect(read('pages/projects/[id]/index.vue')).not.toContain('!max-w-none')
  })

  it('keeps one action block: the phase gate, and the attention block only when the gate is absent', () => {
    expect(pmo('ProjectOverviewTasks.vue')).toMatch(/attention\.value\.length && !props\.gateAction \? 'action' : 'tinted'/)
    expect(pmo('ProjectOverview.vue')).toContain(':gate-action="isGateAction(')
    expect(pmo('ProjectPhaseGate.vue')).toContain("isAction ? 'action' : 'tinted'")
  })

  it('keeps the frame free of spacing hacks and shows the progress once, in the overview tile', () => {
    const frame = read('pages/projects/[id].vue')
    expect(frame).not.toMatch(/-my-2|\bh-9\b|w-1\/3|mb-3/)
    expect(frame).not.toContain('<SharedProgress')
    expect(frame).toContain('<ProjectPhaseStepper')
    expect(pmo('ProjectOverview.vue')).toContain('data-testid="project-overview-progress"')
  })

  it('lists milestones, updates and meetings in a SharedListCard', () => {
    expect(pmo('MilestoneTable.vue')).toContain('<SharedListCard>')
    expect(pmo('MilestoneTable.vue')).toContain('bare')
    expect(pmo('ProjectUpdateList.vue')).toContain('<SharedListCard')
    expect(read('pages/projects/[id]/meetings.vue')).toContain('<SharedListCard>')
  })
})
