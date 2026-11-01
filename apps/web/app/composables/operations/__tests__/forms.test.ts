import { describe, expect, it } from 'vitest'
import { operationListLocation, safeOperationReturnTo, requestFormErrors, processFormErrors, createOperationSubmitGuard, operationAttachmentBody, operationErrorKey, operationPurposeChoices, operationPurposeFromSelection, processStepBody, executionKindLabel } from '../forms'

describe('operation form and route behavior', () => {
  it('preserves list filters/hash without nesting return links', () => {
    expect(operationListLocation('/operations/pending', { q: 'عقد', state: 'pending', page: '2', returnTo: '//evil' }, '#queue')).toBe('/operations/pending?q=%D8%B9%D9%82%D8%AF&state=pending&page=2#queue')
  })
  it('keeps the request type filter in the list location and accepts only known types', () => {
    expect(operationListLocation('/operations/monitoring', { purpose: 'employee', state: 'pending' })).toBe('/operations/monitoring?state=pending&purpose=employee')
    expect(operationPurposeFromSelection('work')).toBe('work')
    for (const value of ['all', 'personal', undefined, ['work']]) expect(operationPurposeFromSelection(value)).toBeUndefined()
    expect(operationPurposeChoices(key => key).map(item => item.value)).toEqual(['all', 'work', 'employee'])
  })
  it('accepts only operation list return destinations', () => {
    expect(safeOperationReturnTo('/account/requests?q=letter#row', '/account/requests')).toBe('/account/requests?q=letter#row')
    expect(safeOperationReturnTo('/operations/monitoring?q=budget#row', '/operations')).toBe('/operations/monitoring?q=budget#row')
    for (const destination of ['//evil.test', 'https://evil.test', '/operations/12', '/operations/../settings', '/operations%2f12']) {
      expect(safeOperationReturnTo(destination, '/operations')).toBe('/operations')
    }
  })
  it('requires the request name and a real selected published process', () => {
    expect(requestFormErrors({ name: ' ', process_id: null }, false)).toEqual({ name: 'required', process_id: 'required' })
    expect(requestFormErrors({ name: 'طلب', process_id: 9 }, false)).toEqual({})
    expect(requestFormErrors({ name: 'طلب', process_id: null }, true)).toEqual({})
  })
  it('requires at least one named stage with positive reviewer user IDs', () => {
    expect(processFormErrors({ name: '', steps: [] })).toEqual({ name: 'required', steps: 'stepsRequired' })
    expect(processFormErrors({ name: 'اعتماد', steps: [{ name: '', reviewer_ids: [0] }] })).toEqual({ 'steps.0.name': 'required', 'steps.0.reviewer_ids': 'reviewersRequired' })
    expect(processFormErrors({ name: 'اعتماد', steps: [{ name: 'مدير', reviewer_ids: [7] }] })).toEqual({})
    expect(processFormErrors({ name: 'اعتماد', steps: [{ name: 'مدير', reviewer_ids: [], resolver: 'hr_leave_approver' }] })).toEqual({})
    expect(processFormErrors({ name: 'اعتماد', steps: [{ name: 'مدير', reviewer_ids: [], resolver: null }] })).toEqual({ 'steps.0.reviewer_ids': 'reviewersRequired' })
  })
  it('sends a resolver stage with no named users and labels a kind from the server list', () => {
    expect(processStepBody({ name: ' مدير ', reviewer_ids: [7, 7], resolver: null })).toEqual({ name: 'مدير', reviewer_ids: [7], resolver: null })
    expect(processStepBody({ name: 'مدير', reviewer_ids: [7] })).toEqual({ name: 'مدير', reviewer_ids: [7], resolver: null })
    expect(processStepBody({ name: 'مدير', reviewer_ids: [7], resolver: 'hr_leave_approver' })).toEqual({ name: 'مدير', reviewer_ids: [], resolver: 'hr_leave_approver' })
    const kinds = [{ key: 'approval', label: 'اعتماد طلب' }]
    expect([executionKindLabel(kinds, 'approval'), executionKindLabel(kinds, 'hr_leave'), executionKindLabel(undefined, 'approval')]).toEqual(['اعتماد طلب', 'hr_leave', 'approval'])
  })
  it('blocks simultaneous submits and permits explicit retry after failure', async () => {
    const gate = createOperationSubmitGuard()
    let calls = 0
    let release!: () => void
    const first = gate.run(async () => { calls++; await new Promise<void>(resolve => { release = resolve }) })
    await gate.run(async () => { calls++ })
    expect(calls).toBe(1)
    expect(gate.pending.value).toBe(true)
    release()
    await first
    await expect(gate.run(async () => { throw new Error('failed') })).rejects.toThrow('failed')
    expect(gate.pending.value).toBe(false)
    await gate.run(async () => { calls++ })
    expect(calls).toBe(2)
  })
})

it('encodes a binary attachment without changing its filename or content', async () => {
  const file = new File([new Uint8Array([0, 255, 65, 66, 10])], 'مرفق.bin', { type: 'application/octet-stream' })
  await expect(operationAttachmentBody(file)).resolves.toEqual({ name: 'مرفق.bin', mimetype: 'application/octet-stream', data: 'AP9BQgo=' })
})

it('keeps the all-status control valid while omitting the API status filter', async () => {
  const { operationStateChoices, operationStateFromSelection } = await import('../forms')
  const choices = operationStateChoices(key => key)
  expect(choices.every(choice => choice.value.length > 0)).toBe(true)
  const all = choices.find(choice => choice.label === 'operations.allStates')!
  expect(operationStateFromSelection(all.value)).toBeUndefined()
  expect(operationStateFromSelection('pending')).toBe('pending')
  expect(operationStateFromSelection('unknown')).toBeUndefined()
})

describe('operation error helpers', () => {
  it('names the unavailable-reviewer error instead of the generic save failure', () => {
    expect(operationErrorKey({ status: 422, code: 'reviewer_not_eligible' })).toBe('reviewerNotEligible')
    expect(operationErrorKey({ status: 409, code: 'conflict' })).toBe('conflict')
    expect(operationErrorKey({ status: 422, code: 'invalid' })).toBe('save')
  })
})
