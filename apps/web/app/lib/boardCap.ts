export function isBoardCapped(loadedCount: number, cap: number, hasNextPage: boolean): boolean {
  return loadedCount > cap || (loadedCount >= cap && hasNextPage)
}
