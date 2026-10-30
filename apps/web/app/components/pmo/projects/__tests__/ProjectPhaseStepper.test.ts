import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ProjectPhase } from '@liwan/contracts'
import { PHASE_COUNT, PHASE_LABEL_KEY, phaseNumber, phaseSteps } from '../../../../composables/projectPhase'
import { renderTemplate } from './helpers/renderTemplate'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../ProjectPhaseStepper.vue')

const render = (current: ProjectPhase) => renderTemplate(filename, {
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${Object.values(params).join('|')}` : key),
  current, steps: phaseSteps(current), PHASE_LABEL_KEY, PHASE_COUNT, phaseNumber,
}, { UIcon: { template: '<i />' } })

describe('ProjectPhaseStepper', () => {
  it('renders the five steps and marks only the current one', async () => {
    const html = await render('planning')
    for (const phase of ['initiating', 'planning', 'executing', 'closing', 'closed']) expect(html).toContain(`data-testid="project-phase-${phase}"`)
    expect(html.match(/aria-current="step"/g)).toHaveLength(1)
    expect(html).toMatch(/data-testid="project-phase-initiating" data-state="done"/)
    expect(html).toMatch(/data-testid="project-phase-planning" data-state="current"/)
  })
  it('names done steps for screen readers', async () => {
    expect((await render('planning')).match(/projects\.phase\.met/g)).toHaveLength(1)
    expect(await render('initiating')).not.toContain('projects.phase.met')
  })
  it('gives the phone a compact current label with n of 5', async () => {
    expect(await render('executing')).toContain('projects.phase.steps.executing')
    expect(await render('executing')).toContain('projects.phase.position:3|5')
  })
})
