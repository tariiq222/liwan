import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AgentError } from 'e2e'
import { JEV_ENDPOINT } from '../e2e/jev-judge.ts'
import { buildActionSpace, buildJevRequest, candidatesOf, jevUltrafast, validateChoice } from '../e2e/jev-ultrafast.ts'

const ALL_VERBS = ['tap', 'type', 'select', 'scroll']

const node = (id, role, name, extra = {}) => ({ id, role, name, ...extra })
const page = (...children) => ({ id: 'root', role: 'main', children })
const FORM = page(
  node('n1', 'textbox', 'Title', { value: '' }),
  node('n2', 'button', 'Save'),
  node('n3', 'combobox', 'Status', {
    value: 'Open',
    children: [node('o1', 'option', 'Open'), node('o2', 'option', 'Closed')],
  }),
  node('n4', 'button', 'Hidden', { states: { hidden: true } }),
  node('n5', 'button', 'Disabled', { states: { disabled: true } }),
  node('n6', 'checkbox', 'Notify', { states: { checked: true } }),
)

/** A Jev body that picks `operation` and, for it, `target` (a head index); other heads are filled uniformly. */
function jevBody(request, { operation, target, value, headOverrides = {} }) {
  const choiceAnswer = (criteria, choice) => {
    const ids = Object.keys(criteria)
    const others = ids.filter((id) => id !== choice)
    const rest = others.length === 0 ? 0 : 0.2 / others.length
    const probabilities = Object.fromEntries(ids.map((id) => [id, id === choice ? (others.length === 0 ? 1 : 0.8) : rest]))
    return { type: 'choice', choice, probabilities, confidence: 0.9 }
  }
  const answers = {}
  for (const [name, question] of Object.entries(request.questions)) {
    if (name === 'operation') answers.operation = choiceAnswer(question.criteria, operation)
    else answers[name] = choiceAnswer(question.criteria, Object.keys(question.criteria)[0])
  }
  if (target !== undefined) answers[`${operation.toLowerCase()}_target`] = choiceAnswer(request.questions[`${operation.toLowerCase()}_target`].criteria, target)
  if (value !== undefined && request.questions.type_text_value !== undefined) {
    answers.type_text_value = choiceAnswer(request.questions.type_text_value.criteria, value)
  }
  Object.assign(answers, headOverrides)
  return { model: 'jev-preview', answers, usage: { input_tokens: 40, output_tokens: 4 } }
}

/** The executor must never touch the agent's model: any use throws. */
const forbiddenModel = new Proxy({}, { get: (_target, property) => { throw new Error(`the text model was touched: ${String(property)}`) } })

/**
 * `script` is a list of decisions or functions of the request body; the executor
 * runs against `trees` (the last repeats), each with its own text.
 */
function setup({ script, trees = [FORM], verbs = ALL_VERBS, instruction = 'save the form', key = 'k', kind = 'act', actionErrors = {} }) {
  const calls = { fetch: [], actions: [], models: [], observe: 0 }
  const queue = [...script]
  const executor = jevUltrafast({
    resolveKey: () => key ?? undefined,
    waitMs: 0,
    retryBaseMs: 0,
    fetch: async (url, init) => {
      const request = JSON.parse(init.body)
      calls.fetch.push({ url, init, request })
      const next = queue.shift()
      if (next === undefined) throw new Error('script exhausted')
      if (next instanceof Response) return next
      return new Response(JSON.stringify(typeof next === 'function' ? next(request) : jevBody(request, next)))
    },
  })
  const act = (name) => async (...args) => {
    calls.actions.push([name, ...args])
    const error = actionErrors[name]
    if (error !== undefined) throw error
  }
  const ctx = {
    step: { kind, index: 0, instruction, params: undefined, secrets: [] },
    attempt: { testId: 't', attemptId: 'a', index: 0, signal: new AbortController().signal, memory: new Map() },
    target: { name: 'web', platform: 'web', verbs: new Set(verbs) },
    signal: new AbortController().signal,
    model: forbiddenModel,
    providerOptions: forbiddenModel,
    ledger: '',
    agentContext: undefined,
    budgets: { maxActions: 25, maxModelCalls: 25, actionsUsed: () => 0, remainingMs: () => 1000, recordModelCall: (usage) => calls.models.push(usage), runTool: (_call, body) => body() },
    observe: async () => {
      const tree = trees[Math.min(calls.observe, trees.length - 1)]
      calls.observe += 1
      return { revision: String(calls.observe), text: JSON.stringify(tree), truncated: false, viewport: { width: 1, height: 1 }, path: '/form', tree }
    },
    actions: Object.fromEntries(['tap', 'type', 'select', 'scroll'].map((name) => [name, act(name)])),
  }
  return { executor, ctx, calls }
}

test('the executor is named, uncached and drives act steps only', async () => {
  const { executor, ctx, calls } = setup({ script: [], kind: 'assert' })
  assert.equal(executor.name, 'jev-ultrafast')
  assert.equal(executor.cache, 'off')
  const verdict = await executor.runStep(ctx)
  assert.deepEqual(verdict, { status: 'blocked', errorCode: 'AUTOMATION_UNSUPPORTED', summary: verdict.summary })
  assert.equal(calls.fetch.length, 0)
})

test('the action space indexes usable elements and offers only supported operations', () => {
  const space = buildActionSpace(FORM, new Set(ALL_VERBS))
  assert.deepEqual(space.elements.map((e) => [e.index, e.role, e.label, e.operations]), [
    ['1', 'textbox', 'Title', ['TYPE_TEXT']],
    ['2', 'button', 'Save', ['CLICK']],
    ['3', 'combobox', 'Status', ['SELECT']],
    ['4', 'checkbox', 'Notify', ['CLICK']],
  ])
  assert.equal(space.elements[3].checked, true)
  assert.deepEqual(space.elements[2].options, [
    { index: '3:1', label: 'Open' },
    { index: '3:2', label: 'Closed' },
  ])
  assert.deepEqual(Object.keys(space.targets.SELECT), ['3:1', '3:2'])
  assert.deepEqual(space.targets.SELECT['3:2'], { nodeId: 'n3', label: 'Closed', option: 'Closed', criterion: space.targets.SELECT['3:2'].criterion })
  assert.deepEqual(space.controls, ['SCROLL_UP', 'SCROLL_DOWN', 'WAIT'])

  const tapOnly = buildActionSpace(FORM, new Set(['tap']))
  assert.deepEqual(Object.keys(tapOnly.targets), ['CLICK'])
  assert.deepEqual(tapOnly.controls, ['WAIT'])
  assert.deepEqual(tapOnly.elements.map((e) => e.label), ['Save', 'Status', 'Open', 'Closed', 'Notify'])
})

test('the request has one operation question and one head per offered operation', async () => {
  const { executor, ctx, calls } = setup({ script: [{ operation: 'DONE' }] })
  await executor.runStep(ctx)
  const [{ url, init, request }] = calls.fetch
  assert.equal(url, JEV_ENDPOINT)
  assert.equal(init.headers.Authorization, 'Bearer k')
  assert.deepEqual(Object.keys(request.questions), ['operation', 'type_text_target', 'click_target', 'select_target', 'type_text_value'])
  assert.deepEqual(Object.keys(request.questions.operation.criteria), [
    'TYPE_TEXT',
    'CLICK',
    'SELECT',
    'SCROLL_UP',
    'SCROLL_DOWN',
    'WAIT',
    'DONE',
    'BLOCKED',
  ])
  assert.equal(request.questions.operation.instructions.goal, 'save the form')
  assert.equal(request.state.page.path, '/form')
  assert.equal(request.state.elements.length, 4)
  assert.deepEqual(request.state.recent_actions, [])
})

test('validateChoice requires exact coverage, a unit sum and the maximum as the choice', () => {
  const ids = ['a', 'b']
  const good = { choice: 'a', probabilities: { a: 0.7, b: 0.3 }, confidence: 0.5 }
  assert.equal(validateChoice(good, ids).choice, 'a')
  const invalid = (cause) => cause.verdict.status === 'failed' && cause.verdict.errorCode === 'MODEL_OUTPUT_INVALID'
  assert.throws(() => validateChoice({ ...good, choice: 'b' }, ids), invalid)
  assert.throws(() => validateChoice({ ...good, probabilities: { a: 0.7, b: 0.1 } }, ids), invalid)
  assert.throws(() => validateChoice({ ...good, probabilities: { a: 1 } }, ids), invalid)
  assert.throws(() => validateChoice({ ...good, probabilities: { a: 0.7, c: 0.3 } }, ids), invalid)
  assert.throws(() => validateChoice({ ...good, choice: 'z' }, ids), invalid)
  assert.throws(() => validateChoice({ ...good, confidence: Number.NaN }, ids), invalid)
  assert.throws(() => validateChoice({ ...good, confidence: 2 }, ids), invalid)
  assert.throws(() => validateChoice(undefined, ids), invalid)
})

test('only the head of the chosen operation is read and executed', async () => {
  const garbage = { choice: 'zz', probabilities: {}, confidence: 1 }
  const { executor, ctx, calls } = setup({
    script: [
      (request) => jevBody(request, { operation: 'CLICK', target: '2', headOverrides: { type_text_target: garbage, select_target: garbage } }),
      { operation: 'DONE' },
    ],
  })
  const verdict = await executor.runStep(ctx)
  assert.equal(verdict.status, 'passed')
  assert.deepEqual(calls.actions, [['tap', { id: 'n2' }]])
})

test('a SELECT choice selects the observed option of its element', async () => {
  const { executor, ctx, calls } = setup({ script: [{ operation: 'SELECT', target: '3:2' }, { operation: 'DONE' }] })
  await executor.runStep(ctx)
  assert.deepEqual(calls.actions, [['select', { id: 'n3' }, 'Closed']])
})

test('scroll and wait controls act without a target head', async () => {
  const { executor, ctx, calls } = setup({
    script: [{ operation: 'SCROLL_DOWN' }, { operation: 'WAIT' }, { operation: 'SCROLL_UP' }, { operation: 'DONE' }],
    trees: [FORM, page(node('n9', 'button', 'More')), page(node('n8', 'button', 'Less')), page(node('n7', 'button', 'End'))],
  })
  const verdict = await executor.runStep(ctx)
  assert.equal(verdict.status, 'passed')
  assert.deepEqual(calls.actions, [['scroll', 'down'], ['scroll', 'up']])
})

test('TYPE_TEXT selects a candidate from the instruction and types it verbatim', async () => {
  const instruction = 'Set the title to "Quarterly plan" and save'
  const { executor, ctx, calls } = setup({
    instruction,
    script: [{ operation: 'TYPE_TEXT', target: '1', value: 'Quarterly plan' }, { operation: 'DONE' }],
  })
  const verdict = await executor.runStep(ctx)
  assert.equal(verdict.status, 'passed')
  assert.deepEqual(calls.actions, [['type', { id: 'n1' }, 'Quarterly plan']])
  assert.deepEqual(calls.models.map((m) => m.provider), ['typesafe', 'typesafe'])
  const criteria = calls.fetch[0].request.questions.type_text_value.criteria
  assert.equal(criteria.none, 'None of these is the requested value.')
  assert.equal(criteria['Quarterly plan'], null)
  assert.match(calls.fetch[0].request.questions.type_text_value.instructions.question, /If the next operation is TYPE_TEXT/)
  assert.deepEqual(calls.fetch[1].request.state.recent_actions, [
    { action: 'TYPE_TEXT Title', operation: 'TYPE_TEXT', text: 'Quarterly plan', page_changed: false },
  ])
})

test('the value question exists only when TYPE_TEXT is offered', async () => {
  const withType = setup({ script: [{ operation: 'DONE' }] })
  await withType.executor.runStep(withType.ctx)
  assert.ok('type_text_value' in withType.calls.fetch[0].request.questions)

  const tapOnly = setup({ script: [{ operation: 'DONE' }], verbs: ['tap'] })
  await tapOnly.executor.runStep(tapOnly.ctx)
  assert.equal('type_text_value' in tapOnly.calls.fetch[0].request.questions, false)
  assert.equal('type_text_target' in tapOnly.calls.fetch[0].request.questions, false)
})

test('the value head is consumed only for TYPE_TEXT, so a garbage head is ignored otherwise', async () => {
  const garbage = { choice: 'zz', probabilities: {}, confidence: 1 }
  const { executor, ctx, calls } = setup({
    script: [
      (request) => jevBody(request, { operation: 'CLICK', target: '2', headOverrides: { type_text_value: garbage } }),
      { operation: 'DONE' },
    ],
  })
  assert.equal((await executor.runStep(ctx)).status, 'passed')
  assert.deepEqual(calls.actions, [['tap', { id: 'n2' }]])
})

test('TYPE_TEXT with the none value blocks without typing', async () => {
  const { executor, ctx, calls } = setup({ script: [{ operation: 'TYPE_TEXT', target: '1', value: 'none' }] })
  const verdict = await executor.runStep(ctx)
  assert.equal(verdict.status, 'blocked')
  assert.equal(verdict.errorCode, 'AUTOMATION_UNSUPPORTED')
  assert.match(verdict.summary, /nothing typed/)
  assert.deepEqual(calls.actions, [])
})

test('TYPE_TEXT with an invalid value answer fails without typing', async () => {
  const { executor, ctx, calls } = setup({
    script: [
      (request) => {
        const body = jevBody(request, { operation: 'TYPE_TEXT', target: '1' })
        body.answers.type_text_value = { choice: 'not a candidate', probabilities: { none: 1 }, confidence: 1 }
        return body
      },
    ],
  })
  const verdict = await executor.runStep(ctx)
  assert.equal(verdict.status, 'failed')
  assert.equal(verdict.errorCode, 'MODEL_OUTPUT_INVALID')
  assert.deepEqual(calls.actions, [])
})

test('candidates are quoted text first, then deduped word spans of one to four words', () => {
  const candidates = candidatesOf('Type "Hello, World" then \'x y\', then Hello.')
  assert.deepEqual(candidates.slice(0, 2), ['Hello, World', 'x y'])
  assert.ok(candidates.includes('Type'))
  assert.ok(candidates.includes('Type "Hello, World" then'))
  assert.ok(!candidates.includes('Type "Hello, World" then \'x y\''), 'five words are too long')
  assert.ok(candidates.includes('Hello'), 'trailing punctuation is stripped')
  assert.equal(new Set(candidates).size, candidates.length)
  assert.ok(candidates.every((candidate) => candidate !== '' && candidate !== 'none'))
  assert.ok(!candidatesOf('open none now').includes('none'))
  assert.deepEqual(candidatesOf(''), [])
})

test('candidates keep instruction order and stop below the 255-key cap', () => {
  const words = Array.from({ length: 300 }, (_, i) => `w${i}`)
  const candidates = candidatesOf(words.join(' '))
  assert.equal(candidates.length, 254)
  assert.deepEqual(candidates.slice(0, 5), ['w0', 'w0 w1', 'w0 w1 w2', 'w0 w1 w2 w3', 'w1'])
  const request = buildJevRequest(buildActionSpace(FORM, new Set(ALL_VERBS)), { path: '/', text: '' }, 'goal', [], candidates)
  assert.equal(Object.keys(request.questions.type_text_value.criteria).length, 255)
})

test('DONE passes and BLOCKED blocks as automation', async () => {
  const done = setup({ script: [{ operation: 'DONE' }] })
  assert.equal((await done.executor.runStep(done.ctx)).status, 'passed')
  const stuck = setup({ script: [{ operation: 'BLOCKED' }] })
  const verdict = await stuck.executor.runStep(stuck.ctx)
  assert.equal(verdict.status, 'blocked')
  assert.equal(verdict.errorCode, 'AUTOMATION_UNSUPPORTED')
})

test('no key blocks before any request', async () => {
  const { executor, ctx, calls } = setup({ script: [], key: null })
  const verdict = await executor.runStep(ctx)
  assert.equal(verdict.status, 'blocked')
  assert.equal(verdict.errorCode, 'MODEL_UNAVAILABLE')
  assert.doesNotMatch(verdict.summary, /Bearer/)
  assert.equal(calls.fetch.length, 0)
})

test('an invalid Jev answer fails the step and executes nothing', async () => {
  const { executor, ctx, calls } = setup({
    script: [(request) => {
      const body = jevBody(request, { operation: 'CLICK', target: '2' })
      body.answers.operation.probabilities.CLICK = 0.01
      return body
    }],
  })
  const verdict = await executor.runStep(ctx)
  assert.equal(verdict.status, 'failed')
  assert.equal(verdict.errorCode, 'MODEL_OUTPUT_INVALID')
  assert.deepEqual(calls.actions, [])
})

test('a retryable Jev status is retried, then reported as a provider failure', async () => {
  const flaky = setup({ script: [new Response('busy', { status: 529 }), { operation: 'DONE' }] })
  assert.equal((await flaky.executor.runStep(flaky.ctx)).status, 'passed')
  assert.equal(flaky.calls.fetch.length, 2)

  const down = setup({ script: [new Response('x', { status: 503 }), new Response('x', { status: 503 }), new Response('x', { status: 503 })] })
  const verdict = await down.executor.runStep(down.ctx)
  assert.equal(verdict.status, 'failed')
  assert.equal(verdict.errorCode, 'MODEL_PROVIDER_FAILED')
  assert.equal(down.calls.fetch.length, 3)

  const rejected = setup({ script: [new Response('no', { status: 401 })] })
  assert.equal((await rejected.executor.runStep(rejected.ctx)).errorCode, 'MODEL_PROVIDER_FAILED')
  assert.equal(rejected.calls.fetch.length, 1)
})

test('a failed action is never retried; the screen is re-observed and decided again', async () => {
  const { executor, ctx, calls } = setup({
    script: [{ operation: 'CLICK', target: '2' }, { operation: 'DONE' }],
    actionErrors: { tap: new AgentError('LOCATOR_NOT_FOUND', 'node n2 is gone') },
  })
  const verdict = await executor.runStep(ctx)
  assert.equal(verdict.status, 'passed')
  assert.equal(calls.actions.length, 1)
  assert.equal(calls.fetch.length, 2)
  assert.equal(calls.observe, 2)
  assert.deepEqual(calls.fetch[1].request.state.recent_actions, [{ action: 'CLICK Save', operation: 'CLICK', page_changed: false }])
})

test('a runner hard stop from an action ends the step untouched', async () => {
  const stop = new AgentError('STEP_BUDGET_EXHAUSTED', 'out of actions')
  const { executor, ctx } = setup({ script: [{ operation: 'CLICK', target: '2' }], actionErrors: { tap: stop } })
  await assert.rejects(executor.runStep(ctx), (cause) => cause === stop)
})

test('three actions that change nothing end the step as blocked', async () => {
  const { executor, ctx, calls } = setup({ script: Array.from({ length: 4 }, () => ({ operation: 'CLICK', target: '2' })) })
  const verdict = await executor.runStep(ctx)
  assert.equal(verdict.status, 'blocked')
  assert.equal(verdict.errorCode, 'AUTOMATION_UNSUPPORTED')
  assert.equal(calls.actions.length, 3)
})

test('the history reaches the next request with the change of the screen', async () => {
  const next = page(node('n2', 'button', 'Done'))
  const { executor, ctx, calls } = setup({ script: [{ operation: 'CLICK', target: '2' }, { operation: 'DONE' }], trees: [FORM, next] })
  await executor.runStep(ctx)
  assert.deepEqual(calls.fetch[1].request.state.recent_actions, [{ action: 'CLICK Save', operation: 'CLICK', page_changed: true }])
})
