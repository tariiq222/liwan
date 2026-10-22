/** The page the assistant was opened from, as `?context=<page>[:<id>]` carries it. */
export interface AiContext {
  page: string
  id: number | null
}

/** Reads a `page` or `page:id` value; anything else is no context. */
export function parseAiContext(raw: unknown): AiContext | null {
  const match = typeof raw === 'string' ? raw.match(/^([a-z]+)(?::(\d+))?$/) : null
  return match ? { page: match[1]!, id: match[2] ? Number(match[2]) : null } : null
}
