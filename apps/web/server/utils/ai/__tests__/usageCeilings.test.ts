import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AI_USAGE_SERVICE_LIMITS } from '@liwan/contracts'

// Odoo cannot import the contracts package, and Nuxt must split its batches the way Odoo accepts them (issue #557): this test
// reads the Odoo constants and fails when either side changes without the other.
const root = join(__dirname, '../../../../../..')
const python = (path: string) => readFileSync(join(root, path), 'utf8')
const number = (source: string, name: string): number => {
  const match = new RegExp(`^${name} = ([0-9_]+)$`, 'm').exec(source)
  if (!match) throw new Error(`${name} is not a plain integer constant`)
  return Number(match[1]!.replaceAll('_', ''))
}

describe('the usage service ceilings', () => {
  const usage = python('odoo-addons/liwan_ai/models/ai_usage.py')
  const settings = python('odoo-addons/liwan_ai/models/ai_settings.py')

  it('match between the contracts and the Odoo route', () => {
    expect(number(settings, 'MAX_INPUT_TOKENS_PER_RUN')).toBe(AI_USAGE_SERVICE_LIMITS.max_input_tokens)
    expect(usage).toMatch(/^SERVICE_MAX_INPUT_TOKENS = MAX_INPUT_TOKENS_PER_RUN$/m)
    expect(number(usage, 'SERVICE_MAX_OUTPUT_TOKENS')).toBe(AI_USAGE_SERVICE_LIMITS.max_output_tokens)
    expect(usage).toMatch(/^SERVICE_MAX_BATCH_TOKENS = 4 \* \(SERVICE_MAX_INPUT_TOKENS \+ SERVICE_MAX_OUTPUT_TOKENS\)$/m)
    expect(4 * (AI_USAGE_SERVICE_LIMITS.max_input_tokens + AI_USAGE_SERVICE_LIMITS.max_output_tokens)).toBe(AI_USAGE_SERVICE_LIMITS.max_batch_tokens)
    expect(usage).toMatch(new RegExp(`^SERVICE_MAX_AGE = timedelta\\(hours=${AI_USAGE_SERVICE_LIMITS.max_age_hours}\\)$`, 'm'))
  })

  it('leave room for one row of the per-row ceilings in any request', () => {
    expect(AI_USAGE_SERVICE_LIMITS.max_input_tokens + AI_USAGE_SERVICE_LIMITS.max_output_tokens).toBeLessThanOrEqual(AI_USAGE_SERVICE_LIMITS.max_batch_tokens)
  })
})
