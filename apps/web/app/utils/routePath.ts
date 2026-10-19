/** Strips the query and hash and any trailing slash, so `/projects/` and `/projects?x=1` compare as `/projects`. */
export function normalizedPath(path: string): string {
  return path.split(/[?#]/, 1)[0]!.replace(/\/+$/, '') || '/'
}
