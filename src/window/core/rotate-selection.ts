// 複数選択の一括回転 (toolbar 変形→回転) 用の純粋幾何ヘルパー。
//
// fabric / DOM 不知。座標規約は fabric と同じ screen-space y-down
// (正の角度 = 時計回り、finalizeDrag と同じ回転式)。

import type { Point } from './path/types';

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** rects 全体の union bbox の中心 (= 一括回転の pivot)。rects が空なら null。 */
export function selectionPivot(rects: ReadonlyArray<Rect>): Point | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.left);
    minY = Math.min(minY, r.top);
    maxX = Math.max(maxX, r.left + r.width);
    maxY = Math.max(maxY, r.top + r.height);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** p を pivot 周りに deg 度回転 (y-down で正 = 時計回り)。 */
export function rotatePointAround(p: Point, pivot: Point, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

/** 角度を [0, 360) に正規化。 */
export function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}
