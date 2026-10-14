const DECLARATION = /(--[a-z0-9-]+)\s*:/gi
const NOT_COLOR = /(radius|width|height|size|shadow|elevation|-z-|-type-|^--text-|^--font|spacing|duration|ease|gap|offset|opacity|-h$)/

export function parseTokenNames(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...new Set([...code.matchAll(DECLARATION)].map(match => match[1]!))]
}

export function groupTokens(names: string[]): { prefix: string; names: string[] }[] {
  const groups = new Map<string, string[]>()
  for (const name of names) {
    const prefix = name.slice(2).split('-')[0]!
    groups.set(prefix, [...(groups.get(prefix) ?? []), name])
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([prefix, list]) => ({ prefix, names: list }))
}

export function isColorToken(name: string): boolean {
  return !NOT_COLOR.test(name)
}
