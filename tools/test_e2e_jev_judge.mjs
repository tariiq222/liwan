import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JEV_ENDPOINT, jevJudge } from '../e2e/jev-judge.ts'

const JUDGMENT_FORMAT = {
  type: 'json',
  name: 'agent-judgment-2',
  schema: { type: 'object', properties: { protocolVersion: { type: 'string', enum: ['agent-judgment-2'] } } },
}
const EXTRACT_FORMAT = { type: 'json', name: 'agent-extract-2', schema: { type: 'object', properties: { found: { type: 'boolean' } } } }

const userPrompt = (text, extra = []) => [
  { role: 'system', content: 'policy' },
  { role: 'user', content: [{ type: 'text', text }, ...extra] },
]
const judgmentText = (observation = '- button "Login"') =>
  `Decide.\n\n<instruction>\nthe login button is visible\n</instruction>\n\n<observation revision="3" viewport="800x600">\n${observation}\n</observation>`

const jevBody = (choice = 'holds') => ({
  model: 'jev-preview',
  answers: { verdict: { type: 'choice', choice, probabilities: { holds: 0.86, fails: 0.1, inconclusive: 0.04 }, confidence: 0.79 } },
  usage: { input_tokens: 120, output_tokens: 3 },
})

function setup({ response = () => new Response(JSON.stringify(jevBody())), key = 'k' } = {}) {
  const calls = { fetch: [], fallback: [] }
  const fallbackResult = { content: [{ type: 'text', text: 'fallback' }] }
  const fallback = {
    specificationVersion: 'v4',
    provider: 'xkiro',
    modelId: 'glm',
    supportedUrls: {},
    doGenerate: async (call) => {
      calls.fallback.push(call)
      return fallbackResult
    },
  }
  const model = jevJudge({
    fallback,
    resolveKey: () => key,
    fetch: async (url, init) => {
      calls.fetch.push({ url, init })
      return response()
    },
  })
  return { model, calls, fallbackResult }
}

test('a judgment becomes one Jev choice question and an agent-judgment-2 reply', async () => {
  const { model, calls } = setup()
  const result = await model.doGenerate({ prompt: userPrompt(judgmentText()), responseFormat: JUDGMENT_FORMAT })

  const [{ url, init }] = calls.fetch
  assert.equal(url, JEV_ENDPOINT)
  assert.equal(init.headers.Authorization, 'Bearer k')
  const body = JSON.parse(init.body)
  assert.equal(body.model, 'jev-preview')
  assert.deepEqual(body.state, { instruction: 'the login button is visible', observation: '- button "Login"' })
  assert.deepEqual(Object.keys(body.questions.verdict.criteria), ['holds', 'fails', 'inconclusive'])

  assert.deepEqual(JSON.parse(result.content[0].text), {
    protocolVersion: 'agent-judgment-2',
    explanation: 'jev: holds (p=0.86, confidence 0.79)',
    verdict: 'holds',
  })
  assert.equal(result.usage.inputTokens.total, 120)
  assert.equal(result.finishReason.unified, 'stop')
  assert.deepEqual(result.warnings, [])
  assert.equal(calls.fallback.length, 0)
})

test('screenshots next to a text observation are dropped with a warning', async () => {
  const { model, calls } = setup()
  const image = { type: 'file', mediaType: 'image/png', data: 'AAAA' }
  const result = await model.doGenerate({ prompt: userPrompt(judgmentText(), [image]), responseFormat: JUDGMENT_FORMAT })

  assert.doesNotMatch(calls.fetch[0].init.body, /AAAA/)
  assert.equal(result.warnings[0].feature, 'screenshots')
})

test('extract schemas and text-less judgments go to the fallback unchanged', async () => {
  const { model, calls, fallbackResult } = setup()
  const extract = { prompt: userPrompt(judgmentText()), responseFormat: EXTRACT_FORMAT }
  assert.equal(await model.doGenerate(extract), fallbackResult)

  const visionOnly = {
    prompt: userPrompt('Decide.\n\n<instruction>\nx\n</instruction>', [{ type: 'file', mediaType: 'image/png', data: 'AAAA' }]),
    responseFormat: JUDGMENT_FORMAT,
  }
  assert.equal(await model.doGenerate(visionOnly), fallbackResult)

  assert.deepEqual(calls.fallback, [extract, visionOnly])
  assert.equal(calls.fetch.length, 0)
})

test('HTTP failures are mapped to retryable and permanent API errors', async () => {
  const cases = [[429, true], [529, true], [503, true], [400, false], [401, false], [422, false]]
  for (const [status, retryable] of cases) {
    const { model } = setup({ response: () => new Response('{"error":"x"}', { status }) })
    await assert.rejects(
      model.doGenerate({ prompt: userPrompt(judgmentText()), responseFormat: JUDGMENT_FORMAT }),
      (error) => error.statusCode === status && error.isRetryable === retryable && error.message.includes(String(status)),
    )
  }
})

test('a response without a verdict choice is an explicit error', async () => {
  const { model } = setup({ response: () => new Response(JSON.stringify({ answers: {} })) })
  await assert.rejects(
    model.doGenerate({ prompt: userPrompt(judgmentText()), responseFormat: JUDGMENT_FORMAT }),
    /without a verdict choice/,
  )
})

test('a missing key names where to put it, and streaming is refused', async () => {
  const { model, calls } = setup({ key: '' })
  await assert.rejects(
    model.doGenerate({ prompt: userPrompt(judgmentText()), responseFormat: JUDGMENT_FORMAT }),
    /JEV_API_KEY/,
  )
  assert.equal(calls.fetch.length, 0)
  assert.throws(() => model.doStream({}), /streaming is not supported/)
})
