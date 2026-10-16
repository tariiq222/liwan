/** A JSON POST to one of the BFF's /api/auth routes. */
export type AuthPost = <T = unknown>(path: string, body: object) => Promise<T>

export const authPost: AuthPost = <T>(path: string, body: object) =>
  $fetch<T>(path, { method: 'POST', body })
