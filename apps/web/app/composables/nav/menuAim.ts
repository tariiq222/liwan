export interface AimPoint { x: number; y: number }
export interface AimTarget { left: number; right: number; top: number; bottom: number }

const cross = (o: AimPoint, a: AimPoint, b: AimPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/**
 * True when the pointer, moving from `from` to `to`, heads into `menu`: `to` lies inside the triangle formed by
 * `from` and the menu edge nearest to it, and it got closer to that edge. Works for either reading direction.
 */
export function aimsAtMenu(from: AimPoint, to: AimPoint, menu: AimTarget): boolean {
  const edgeX = Math.abs(from.x - menu.left) < Math.abs(from.x - menu.right) ? menu.left : menu.right
  if (Math.abs(to.x - edgeX) >= Math.abs(from.x - edgeX)) return false
  const top = { x: edgeX, y: menu.top }
  const bottom = { x: edgeX, y: menu.bottom }
  const sides = [cross(from, top, to), cross(top, bottom, to), cross(bottom, from, to)]
  return sides.every(side => side >= 0) || sides.every(side => side <= 0)
}
