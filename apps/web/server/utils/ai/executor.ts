import type { AiTool } from '@nasq/contracts'

export type ToolRequest = { method: 'GET' | 'POST' | 'PATCH'; path: string; query: Record<string, unknown>; body: Record<string, unknown> | undefined }
export type ToolError = { code: string; message: string }
export type ToolResult = { ok: true; data: unknown } | { ok: false; error: ToolError }

function resolve(values: Record<string, unknown>, input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && value.startsWith('$')) {
      const supplied = input[value.slice(1)]
      if (supplied !== undefined && supplied !== null) out[key] = supplied
    } else {
      out[key] = value
    }
  }
  return out
}

const PATH_VALUE = /^[\w.~-]+$/

/** Contract ع1 `input_map`: `$name` reads the input, constants stay, path values are URL-encoded. */
export function buildToolRequest(tool: AiTool, input: Record<string, unknown>): ToolRequest {
  if (!tool.route) throw new Error(`${tool.name} has no route`)
  const pathValues = resolve(tool.input_map.path ?? {}, input)
  const path = tool.route.path.replace(/\{([a-z_][a-z0-9_]*)\}/g, (_, name: string) => {
    const value = pathValues[name]
    if (value === undefined) throw new Error(`missing path value ${name}`)
    const text = String(value)
    // Numbers and simple slugs only. `.`/`..` pass the pattern but would be normalized away by Odoo's router.
    if (!PATH_VALUE.test(text) || text === '.' || text === '..') throw new Error(`invalid path value ${name}`)
    return text
  })
  if (new URL(path, 'http://x').pathname !== path) throw new Error('invalid path')
  const body = tool.input_map.body ? resolve(tool.input_map.body, input) : undefined
  return { method: tool.route.method, path, query: resolve(tool.input_map.query ?? {}, input), body }
}

type Node = Record<string, unknown>

const MAX_RESULT_BYTES = 200_000
const MAX_ERROR_CODE = 60
const MAX_ERROR_MESSAGE = 2000

/** A failed result with a bounded code and message: the service never receives an unbounded error text. */
export const toolError = (code: string, message: string): ToolResult => ({ ok: false, error: { code: code.slice(0, MAX_ERROR_CODE), message: message.slice(0, MAX_ERROR_MESSAGE) } })

function pick(source: unknown, segments: string[], target: Node): void {
  if (segments.length === 0 || source === null || typeof source !== 'object') return
  const [head, ...rest] = segments
  const isArray = head!.endsWith('[]')
  const key = isArray ? head!.slice(0, -2) : head!
  const value = (source as Node)[key]
  if (value === undefined) return
  if (isArray) {
    if (!Array.isArray(value)) return
    const rows = (target[key] as Node[] | undefined) ?? value.map(() => ({}))
    target[key] = rows
    value.forEach((row, index) => {
      if (rest.length === 0) rows[index] = row as Node
      else pick(row, rest, rows[index]!)
    })
    return
  }
  if (rest.length === 0) {
    target[key] = value
    return
  }
  const child = (target[key] as Node | undefined) ?? {}
  target[key] = child
  pick(value, rest, child)
}

/** Contract ع1 `result_summary`: a whitelist of dotted paths; `[]` means every element. */
export function summarizeResult(data: unknown, paths: string[]): unknown {
  const target: Node = {}
  for (const path of paths) pick(data, path.split('.'), target)
  return target
}

type ErrorBody = { code?: unknown; message?: unknown; error?: { code?: unknown; message?: unknown } }

/** Odoo errors are flat bodies `{code, message, field?, details?}`; a nested `{error: {...}}` is read only as a fallback. */
export function upstreamError(body: unknown): { code: string; message: string; details?: unknown } | null {
  if (body === null || typeof body !== 'object') return null
  const flat = body as ErrorBody
  const source = typeof flat.code === 'string' ? flat : flat.error
  if (!source || typeof source.code !== 'string') return null
  const details = (source as { details?: unknown }).details
  return { code: source.code, message: typeof source.message === 'string' ? source.message : '', ...(details !== undefined ? { details } : {}) }
}

export function toolResultFromUpstream(status: number, body: unknown, tool: AiTool): ToolResult {
  if (status >= 200 && status < 300) {
    const data = summarizeResult(body, tool.result_summary)
    if (Buffer.byteLength(JSON.stringify(data)) > MAX_RESULT_BYTES) return toolError('result_too_large', 'The result is too large to hand to the assistant')
    return { ok: true, data }
  }
  const error = upstreamError(body)
  if (error) return toolError(error.code, error.message)
  return toolError('http_error', `upstream status ${status}`)
}

/** The service accepts at most this many tool calls per run (apps/ai-service contracts.Limits). */
export const MAX_TOOL_CALLS_PER_RUN = 50
export const DEFAULT_TOOL_CALLS_PER_RUN = 8

/** The operator's `ai.tool_calls.per_run` limit (null = unset), clamped to what the service accepts. */
export function toolCallBudget(limit: number | null): number {
  return Math.min(limit ?? DEFAULT_TOOL_CALLS_PER_RUN, MAX_TOOL_CALLS_PER_RUN)
}
