import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AI_MAX_COST_UNITS, AI_USAGE_SERVICE_LIMITS, AiModelUsageEventSchema, AiUsageRecordSchema } from '@liwan/contracts'

// Odoo cannot import the contracts package, and Nuxt must split its requests the way Odoo admits them (issue #557): this test reads
// the Odoo constants and the AI service's own wire contract and fails when any of them changes without the others.
const root = join(__dirname, '../../../../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const number = (source: string, name: string): number => {
  const match = new RegExp(`^${name} = ([0-9_]+)$`, 'm').exec(source)
  if (!match) throw new Error(`${name} is not a plain integer constant`)
  return Number(match[1]!.replaceAll('_', ''))
}

describe('the usage service size rules', () => {
  const usage = read('odoo-addons/liwan_ai/models/ai_usage.py')
  const wire = read('apps/ai-service/src/liwan_ai_service/contracts.py')

  it('keep one per-row bound: the AI service wire contract, mirrored by Odoo and by the zod schemas', () => {
    expect(number(usage, 'MAX_TOKENS')).toBe(AI_USAGE_SERVICE_LIMITS.max_row_tokens)
    // `ModelUsageEvent` is the only producer of a row's counts; if it ever allows more than Odoo accepts, a legitimate row would be refused.
    const counts = [...wire.matchAll(/^\s+(input_tokens|output_tokens): int \| None = Field\(ge=0, le=([0-9_]+)\)/gm)].map(match => [match[1], Number(match[2]!.replaceAll('_', ''))])
    expect(counts).toEqual([['input_tokens', AI_USAGE_SERVICE_LIMITS.max_row_tokens], ['output_tokens', AI_USAGE_SERVICE_LIMITS.max_row_tokens]])
    const row = { conversation_id: 'r_1', call_id: '0123456789abcdef', kind: 'plan', capability: 'standard', billing: 'platform', provider: 'x', model: 'm', outcome: 'ok', cost: null, charge: null, called_at: '2026-11-10T10:00:00Z' }
    const max = AI_USAGE_SERVICE_LIMITS.max_row_tokens
    expect(AiUsageRecordSchema.safeParse({ ...row, input_tokens: max, output_tokens: max }).success).toBe(true)
    expect(AiUsageRecordSchema.safeParse({ ...row, input_tokens: max + 1, output_tokens: 0 }).success).toBe(false)
    expect(AiModelUsageEventSchema.safeParse({ call_id: row.call_id, outcome: 'ok', input_tokens: max + 1, output_tokens: 0, cost: null, charge: null }).success).toBe(false)
  })

  it('keep one bound for cost and charge: the integer column of Odoo, in all three languages', () => {
    expect(AI_MAX_COST_UNITS).toBe(number(usage, 'MAX_COST_UNITS'))
    expect(AI_MAX_COST_UNITS).toBe(number(wire, 'MAX_COST_UNITS'))
  })

  it('keep one aggregate bound: the per-minute token budget is two maximal rows, so any valid row fits an empty window', () => {
    expect(usage).toMatch(/^SERVICE_MAX_TOKENS_PER_MINUTE = 2 \* MAX_TOKENS$/m)
    expect(AI_USAGE_SERVICE_LIMITS.max_request_tokens).toBe(2 * AI_USAGE_SERVICE_LIMITS.max_row_tokens)
  })

  it('keep the age window', () => {
    expect(usage).toMatch(new RegExp(`^SERVICE_MAX_AGE = timedelta\\(hours=${AI_USAGE_SERVICE_LIMITS.max_age_hours}\\)$`, 'm'))
  })

  it('no longer carries a per-row or per-request ceiling derived from a run setting', () => {
    expect(usage).not.toMatch(/SERVICE_MAX_(INPUT|OUTPUT|BATCH)_TOKENS/)
  })
})
