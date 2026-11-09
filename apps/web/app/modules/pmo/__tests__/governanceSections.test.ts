import { describe, expect, it } from 'vitest'
import { governanceSections } from '../governanceSections'
import { activeProjectSection, activePlanningSection } from '../projectRoutes'
describe('tool section ownership', () => {
 it('keeps governance scoped to governance records', () => expect(governanceSections(12).map(s=>s.id)).toEqual(['charter','stakeholders','raci','register','changes']))
 it('respects change control', () => expect(governanceSections(12,{changeControl:false}).map(s=>s.id)).not.toContain('changes'))
 it('keeps stable baseline and EVM paths in their proper tool', () => {
 expect(activeProjectSection('/projects/12/baselines/2')).toBe('tasks')
 expect(activePlanningSection('/projects/12/baselines/2')).toBe('baselines')
 expect(activeProjectSection('/projects/12/evm')).toBe('finance')
 })
})
