export interface AimPoint { x: number; y: number }
export interface AimTarget { left: number; right: number; top: number; bottom: number }

const cross = (o: AimPoint, a: AimPoint, b: AimPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
/** Sideways progress needed per unit of vertical travel, so drift while moving along the rail is not aiming. */
const MIN_SIDEWAYS_RATIO = 0.15

/**
 * True when the pointer, moving from `from` to `to`, heads into `menu`: `to` lies inside the triangle formed by
 * `from` and the menu edge nearest to it, and it moved toward that edge by at least 15% of its vertical travel.
 * Works for either reading direction.
 */
export function aimsAtMenu(from: AimPoint, to: AimPoint, menu: AimTarget): boolean {
  const edgeX = Math.abs(from.x - menu.left) < Math.abs(from.x - menu.right) ? menu.left : menu.right
  const sideways = Math.abs(from.x - edgeX) - Math.abs(to.x - edgeX)
  if (sideways <= 0 || sideways < MIN_SIDEWAYS_RATIO * Math.abs(to.y - from.y)) return false
  const top = { x: edgeX, y: menu.top }
  const bottom = { x: edgeX, y: menu.bottom }
  const sides = [cross(from, top, to), cross(top, bottom, to), cross(bottom, from, to)]
  return sides.every(side => side >= 0) || sides.every(side => side <= 0)
}
