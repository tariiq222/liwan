import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import type { ProjectPhaseState } from '@nasq/contracts'
import { PHASE_LABEL_KEY, canMoveForward, gateCheckRows } from '../../../../composables/projectPhase'
import { renderTemplate } from './helpers/renderTemplate'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../ProjectPhaseGate.vue')

async function render(state: ProjectPhaseState, opts: { canManage?: boolean; stepBack?: boolean } = {}) {
  const canManage = opts.canManage ?? true
  const html = await renderTemplate(filename, {
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${Object.values(params).join('|')}` : key),
    project: { id: 7 }, state, rows: gateCheckRows(7, state.next_checks), canManage,
    canAdvance: canMoveForward(state, canManage), isClosed: state.current === 'closed',
    phaseLabel: (phase: string) => (PHASE_LABEL_KEY as Record<string, string>)[phase], stepBack: opts.stepBack ?? false,
    isPending: false, hydrated: true, run: () => {},
  }, {
    UIcon: { template: '<i />' },
    UButton: defineComponent({ props: ['label', 'disabled', 'to'], setup: (props, { attrs }) => () => h(props.to ? 'a' : 'button', { ...attrs, href: props.to, disabled: props.disabled || undefined }, props.label) }),
    SharedInlineConfirm: defineComponent({ props: ['title'], setup: (props, { attrs }) => () => h('div', attrs, props.title) }),
  })
  return { html, has: (id: string) => html.includes(`data-testid="${id}"`), moveDisabled: /<button[^>]*data-testid="project-phase-move"[^>]*disabled/.test(html) || /<button[^>]*disabled[^>]*data-testid="project-phase-move"/.test(html) }
}

const initiating = (ok: boolean): ProjectPhaseState => ({ current: 'initiating', next: 'planning', previous: null, next_checks: [{ key: 'charter_approved', ok }] })

describe('ProjectPhaseGate', () => {
  it('blocks the move and links the unmet check to the charter', async () => {
    const w = await render(initiating(false))
    expect(w.moveDisabled).toBe(true)
    expect(w.html).toContain('href="/projects/7/charter"')
    expect(w.html).toContain('projects.phase.gateTitle:projects.phase.steps.planning')
  })
  it('enables the move when every check is met', async () => {
    const w = await render(initiating(true))
    expect(w.has('project-phase-move')).toBe(true)
    expect(w.moveDisabled).toBe(false)
    expect(w.has('project-phase-fix')).toBe(false)
  })
  it('hides the actions from a non-manager but keeps the checks', async () => {
    const w = await render(initiating(false), { canManage: false })
    expect(w.has('project-phase-move')).toBe(false)
    expect(w.has('project-phase-check-charter_approved')).toBe(true)
    expect(w.has('project-phase-fix')).toBe(false)
  })
  it('offers a step back with an inline confirmation', async () => {
    const state: ProjectPhaseState = { current: 'executing', next: 'closing', previous: 'planning', next_checks: [] }
    expect((await render(state)).has('project-phase-back')).toBe(true)
    const confirming = await render(state, { stepBack: true })
    expect(confirming.has('project-phase-back-confirm')).toBe(true)
    expect(confirming.has('project-phase-move')).toBe(false)
  })
  it('says a closed project is closed', async () => {
    const w = await render({ current: 'closed', next: null, previous: 'closing', next_checks: [] })
    expect(w.has('project-phase-closed')).toBe(true)
    expect(w.has('project-phase-move')).toBe(false)
  })
})
