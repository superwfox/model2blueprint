import type { WallPoint } from './brush-types.ts';
import type { Vec3 } from './types.ts';

/** Incoming XZ direction; a curve uses its end tangent. Vertical segments keep the last heading. */
export function wallHeading(points: readonly WallPoint[]): number {
  for (let i = points.length - 1; i > 0; i--) {
    const b = points[i].position;
    let a = points[i].control ?? points[i - 1].position;
    if (Math.hypot(b[0] - a[0], b[2] - a[2]) < 1e-8) a = points[i - 1].position;
    if (Math.hypot(b[0] - a[0], b[2] - a[2]) > 1e-8) return Math.atan2(b[2] - a[2], b[0] - a[0]);
  }
  return 0;
}
export function wallTurn(points: readonly WallPoint[], position: Vec3): number | undefined {
  const last = points.at(-1)?.position; if (!last) return;
  const dx = position[0] - last[0], dz = position[2] - last[2]; if (Math.hypot(dx, dz) < 1e-8) return;
  const angle = Math.atan2(dz, dx) - wallHeading(points);
  const degrees = Math.atan2(Math.sin(angle), Math.cos(angle)) * 180 / Math.PI;
  return Math.abs(degrees) < 1e-8 ? 0 : degrees;
}
/** Shared by hover and click. Angle snapping still produces ordinary integer block coordinates. */
export function constrainWallPoint(points: readonly WallPoint[], position: Vec3, height: boolean, angle: boolean): Vec3 {
  const result: Vec3 = [...position], last = points.at(-1)?.position; if (!last) return result;
  if (height) result[1] = last[1];
  if (angle) {
    const turn = wallTurn(points, position);
    if (turn !== undefined) {
      const heading = wallHeading(points) + Math.round(turn / 45) * Math.PI / 4;
      const distance = Math.hypot(position[0] - last[0], position[2] - last[2]);
      result[0] = last[0] + Math.round(Math.cos(heading) * distance);
      result[2] = last[2] + Math.round(Math.sin(heading) * distance);
    }
  }
  return result;
}
