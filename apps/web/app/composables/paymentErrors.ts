/** The locale key a refusal's code maps to in `keys`, or null when the map does not word it (the caller then shows the API's own text). */
export function errorKeyFor(error: unknown, keys: Readonly<Record<string, string>>): string | null {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return typeof code === 'string' && Object.hasOwn(keys, code) ? keys[code]! : null
}
